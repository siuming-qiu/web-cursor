/**
 * [INPUT]: project asset id in URL
 * [OUTPUT]: image bytes from private Blob storage
 * [POS]: A 域项目资产读取接口 —— 让生成页面能用稳定 URL 引用私有 Blob 中的生成图
 * [PROTOCOL]: asset id 是能力型 URL；不要求 x-owner-id，因为 <img> 不能带自定义 header
 */
import { get } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { projectAssets } from "@/server/db/schema";

type Ctx = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CROSS_ORIGIN_IMAGE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function assetError(message: string, status: number) {
  return new Response(message, {
    status,
    headers: CROSS_ORIGIN_IMAGE_HEADERS,
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [asset] = await db
    .select({
      blobPath: projectAssets.blobPath,
      mimeType: projectAssets.mimeType,
      sizeBytes: projectAssets.sizeBytes,
    })
    .from(projectAssets)
    .where(and(eq(projectAssets.id, id), isNull(projectAssets.deletedAt)))
    .limit(1);

  if (!asset) return assetError("Not Found", 404);

  const result = await get(asset.blobPath, { access: "private" }) as {
    statusCode?: number;
    stream?: ReadableStream<Uint8Array>;
  } | null;

  if (!result?.stream) return assetError("Not Found", 404);
  if (result.statusCode !== undefined && result.statusCode !== 200) {
    return assetError("Not Found", 404);
  }

  return new Response(result.stream, {
    headers: {
      ...CROSS_ORIGIN_IMAGE_HEADERS,
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.sizeBytes),
      "Cache-Control": "public, max-age=0, s-maxage=0, must-revalidate",
    },
  });
}
