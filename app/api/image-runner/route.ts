/**
 * [INPUT]: GET from Vercel Cron or POST from local/manual runner trigger
 * [OUTPUT]: one bounded image runner tick summary
 * [POS]: A 域生图 runner 触发接口 —— 无长驻 worker，适配 serverless 部署
 * [PROTOCOL]: 生产环境必须配置 CRON_SECRET 或 IMAGE_RUNNER_SECRET 并用 Bearer 调用；只用 GET/POST
 */
import crypto from "node:crypto";
import { z } from "zod";
import { runImageRunnerTick } from "@/server/image/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  batchSize: z.number().int().min(1).max(10).optional(),
}).strict();

/** 先散列到定长再比较：避免按字节短路比较泄漏 secret 前缀，也避免长度不等时 timingSafeEqual 抛错。 */
function secretMatches(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function authorized(req: Request): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.IMAGE_RUNNER_SECRET]
    .filter((secret): secret is string => Boolean(secret));
  // 未配 secret：本地开发放行；生产一律 401（fail closed）。
  if (!secrets.length) return process.env.NODE_ENV !== "production";

  const authorization = req.headers.get("authorization");
  if (!authorization) return false;
  return secrets.some((secret) => secretMatches(authorization, `Bearer ${secret}`));
}

async function runAuthorizedTick(req: Request, batchSize?: number) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runImageRunnerTick(batchSize, {
    publicBaseUrl: new URL(req.url).origin,
  }));
}

export async function GET(req: Request) {
  return runAuthorizedTick(req);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (error) {
    return Response.json({ error: "bad request", detail: String(error) }, { status: 400 });
  }

  return runAuthorizedTick(req, body.batchSize);
}
