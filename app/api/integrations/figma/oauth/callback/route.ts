/**
 * [INPUT]: Figma OAuth callback query code/state
 * [OUTPUT]: Encrypted figma_connections row, consumed oauth_states row, then redirect back to Web Cursor
 * [POS]: A 域 Figma OAuth 回调 —— token 只在服务端换取并加密落库
 * [PROTOCOL]: state 必须存在、未过期、未消费；失败不伪装授权成功
 */
import { completeFigmaOAuthCallback, FigmaOAuthError } from "@/server/figma/oauth";

const CALLBACK_PAGE_PATH = "/integrations/figma/oauth/callback";

function callbackPageUrl(origin: string, params: Record<string, string>) {
  const url = new URL(CALLBACK_PAGE_PATH, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return Response.redirect(callbackPageUrl(url.origin, {
        status: "error",
        code: "FIGMA_BAD_CALLBACK",
        message: "Missing OAuth code or state.",
      }), 302);
    }

    const redirectTo = await completeFigmaOAuthCallback(req, state, code);
    return Response.redirect(callbackPageUrl(url.origin, {
      status: "success",
      returnTo: redirectTo,
    }), 302);
  } catch (error) {
    if (error instanceof FigmaOAuthError) {
      return Response.redirect(callbackPageUrl(url.origin, {
        status: "error",
        code: error.code,
        message: error.message,
      }), 302);
    }
    return Response.redirect(callbackPageUrl(url.origin, {
      status: "error",
      code: "FIGMA_CALLBACK_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }), 302);
  }
}
