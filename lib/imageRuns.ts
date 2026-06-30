/**
 * [INPUT]: image run id
 * [OUTPUT]: typed image run status from local backend
 * [POS]: B 域生图任务客户端 —— 只读取本地后端 run/job 状态，不碰 provider
 * [PROTOCOL]: 本地 API 契约由共享 TS 类型约束；这里不重复手写字段 parser
 */
"use client";

import { req } from "@/lib/api";
import type { ImageRunView } from "@/lib/types";
import { ImageRunStatus } from "@/types/image";

export function imageRunTerminal(status: ImageRunView["status"]) {
  return status === ImageRunStatus.Succeeded || status === ImageRunStatus.Failed;
}

export function fetchImageRun(runId: string): Promise<ImageRunView> {
  return req<ImageRunView>("GET", `/api/image-runs/${runId}`);
}
