/**
 * [INPUT]: ownerId、OAuth callback code/state、Figma OAuth 环境变量
 * [OUTPUT]: Figma OAuth 跳转 URL、连接状态、加密后的 token 连接记录
 * [POS]: A 域 Figma 授权服务 —— token 只在服务端换取、加密和读取
 * [PROTOCOL]: 第一阶段只绑定匿名 ownerId；不要在这里扩展通用 provider/authType 抽象
 */
import "server-only";
import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { figmaConnections, oauthStates } from "@/server/db/schema";

const FIGMA_AUTHORIZE_URL = "https://www.figma.com/oauth";
export const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const FigmaOAuthScope = {
  FileContentRead: "file_content:read",
} as const;

const FIGMA_OAUTH_SCOPES = [FigmaOAuthScope.FileContentRead] as const;

export const FigmaOAuthErrorCode = {
  BadOwner: "FIGMA_BAD_OWNER",
  BadReturnTo: "FIGMA_BAD_RETURN_TO",
  MissingConfig: "FIGMA_MISSING_CONFIG",
  InvalidState: "FIGMA_INVALID_STATE",
  TokenExchangeFailed: "FIGMA_TOKEN_EXCHANGE_FAILED",
  BadTokenResponse: "FIGMA_BAD_TOKEN_RESPONSE",
} as const;

export type FigmaOAuthErrorCode =
  typeof FigmaOAuthErrorCode[keyof typeof FigmaOAuthErrorCode];

export class FigmaOAuthError extends Error {
  constructor(
    readonly code: FigmaOAuthErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const OwnerIdSchema = z.string().uuid();

const FigmaTokenResponseSchema = z.object({
  token_type: z.literal("bearer"),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user_id_string: z.string().min(1),
}).passthrough();

type FigmaTokenResponse = z.infer<typeof FigmaTokenResponseSchema>;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new FigmaOAuthError(FigmaOAuthErrorCode.MissingConfig, `${name} is not configured.`, 500);
  return value;
}

function getClientConfig(req: Request) {
  const url = new URL(req.url);
  return {
    clientId: readRequiredEnv("FIGMA_CLIENT_ID"),
    clientSecret: readRequiredEnv("FIGMA_CLIENT_SECRET"),
    redirectUri: process.env.FIGMA_REDIRECT_URI?.trim()
      || `${url.origin}/api/integrations/figma/oauth/callback`,
  };
}

export function parseOwnerId(value: string | null): string {
  const parsed = OwnerIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new FigmaOAuthError(FigmaOAuthErrorCode.BadOwner, "ownerId must be a UUID.");
  }
  return parsed.data;
}

export function parseReturnTo(value: string | null): string {
  const returnTo = value?.trim() || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    throw new FigmaOAuthError(FigmaOAuthErrorCode.BadReturnTo, "returnTo must be a same-origin relative path.");
  }
  return returnTo;
}

function randomUrlToken(byteLength: number): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function encryptionKey(): Buffer {
  const secret = readRequiredEnv("FIGMA_TOKEN_ENCRYPTION_KEY");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new FigmaOAuthError(FigmaOAuthErrorCode.BadTokenResponse, "Encrypted token format is invalid.", 500);
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function expiresAtFrom(token: FigmaTokenResponse): Date {
  return new Date(Date.now() + token.expires_in * 1000);
}

export async function createFigmaOAuthStart(req: Request, ownerId: string, returnTo: string): Promise<string> {
  const config = getClientConfig(req);
  const state = randomUrlToken(32);
  const verifier = randomUrlToken(64);
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  await db.insert(oauthStates).values({
    ownerId,
    state,
    codeVerifier: verifier,
    redirectTo: returnTo,
    expiresAt,
  });

  const url = new URL(FIGMA_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", FIGMA_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function exchangeCode(req: Request, code: string, verifier: string): Promise<FigmaTokenResponse> {
  const config = getClientConfig(req);
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const response = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new FigmaOAuthError(
      FigmaOAuthErrorCode.TokenExchangeFailed,
      `Figma token exchange failed with status ${response.status}.`,
      502,
    );
  }

  const parsed = FigmaTokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FigmaOAuthError(FigmaOAuthErrorCode.BadTokenResponse, parsed.error.message, 502);
  }
  return parsed.data;
}

export async function completeFigmaOAuthCallback(req: Request, state: string, code: string): Promise<string> {
  const [row] = await db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, new Date())))
    .limit(1);

  if (!row) {
    throw new FigmaOAuthError(FigmaOAuthErrorCode.InvalidState, "OAuth state is invalid, expired, or already consumed.");
  }

  const token = await exchangeCode(req, code, row.codeVerifier);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(figmaConnections)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(figmaConnections.ownerId, row.ownerId), isNull(figmaConnections.revokedAt)));

    await tx.insert(figmaConnections).values({
      ownerId: row.ownerId,
      figmaUserId: token.user_id_string,
      accessTokenEncrypted: encryptToken(token.access_token),
      refreshTokenEncrypted: encryptToken(token.refresh_token),
      expiresAt: expiresAtFrom(token),
      scopes: [...FIGMA_OAUTH_SCOPES],
      updatedAt: now,
    });

    await tx.update(oauthStates).set({ consumedAt: now }).where(eq(oauthStates.id, row.id));
  });

  return row.redirectTo;
}

export async function getFigmaConnectionStatus(ownerId: string) {
  const [connection] = await db
    .select({
      figmaUserId: figmaConnections.figmaUserId,
      scopes: figmaConnections.scopes,
      expiresAt: figmaConnections.expiresAt,
    })
    .from(figmaConnections)
    .where(and(eq(figmaConnections.ownerId, ownerId), isNull(figmaConnections.revokedAt)))
    .limit(1);

  if (!connection) return { status: "disconnected" as const };
  return {
    status: "connected" as const,
    figmaUserId: connection.figmaUserId,
    scopes: connection.scopes,
    expiresAt: connection.expiresAt?.toISOString() ?? null,
  };
}

export async function disconnectFigma(ownerId: string): Promise<void> {
  await db
    .update(figmaConnections)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(figmaConnections.ownerId, ownerId), isNull(figmaConnections.revokedAt)));
}
