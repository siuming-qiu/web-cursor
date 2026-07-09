/**
 * [INPUT]: Request 的 x-owner-id header，或裸 ownerId 字符串（OAuth 跳转只能从 query 取）
 * [OUTPUT]: 校验通过的 ownerId，或 null
 * [POS]: A 域 owner 身份解析 —— 所有 Route Handler 读取 ownerId 的唯一入口
 * [PROTOCOL]: ownerId 必须是 UUID；格式非法与缺失一律视为未授权，不让垃圾值落进 owner_id 列
 */
import "server-only";
import { z } from "zod";

const OwnerIdSchema = z.string().uuid();

/** 校验裸 ownerId 字符串；非 UUID 返回 null。 */
export function parseOwnerId(value: string | null | undefined): string | null {
  const parsed = OwnerIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 从请求头读 ownerId；缺失或非 UUID 返回 null。 */
export function ownerIdFrom(req: Request): string | null {
  return parseOwnerId(req.headers.get("x-owner-id"));
}
