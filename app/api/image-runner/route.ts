/**
 * [INPUT]: GET from Vercel Cron or POST from local/manual runner trigger
 * [OUTPUT]: one bounded image runner tick summary
 * [POS]: A 域生图 runner 触发接口 —— 无长驻 worker，适配 serverless 部署
 * [PROTOCOL]: 生产环境必须配置 CRON_SECRET 或 IMAGE_RUNNER_SECRET 并用 Bearer 调用；只用 GET/POST
 */
import { z } from "zod";
import { runImageRunnerTick } from "@/server/image/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  batchSize: z.number().int().min(1).max(10).optional(),
});

function authorized(req: Request): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.IMAGE_RUNNER_SECRET].filter(Boolean);
  if (!secrets.length) return process.env.NODE_ENV !== "production";
  const authorization = req.headers.get("authorization");
  return secrets.some((secret) => authorization === `Bearer ${secret}`);
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
