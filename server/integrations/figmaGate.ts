/**
 * [INPUT]: ownerId + conversationId + raw user message
 * [OUTPUT]: integration_card assistant message when Figma OAuth is required
 * [POS]: A 域 Figma 授权 gate —— 用户提 Figma 链接但未连接时短路 LLM
 * [PROTOCOL]: 这里只检测明确 Figma design/file URL，不解析 node，不读取 Figma，不猜设计内容
 */
import "server-only";
import type { AppLocale } from "@/i18n/locales";
import { appendMessage } from "@/server/messages";
import { getFigmaConnectionStatus } from "@/server/figma/oauth";
import { AGENT_MODEL } from "@/server/models";
import {
  IntegrationAction,
  IntegrationCardKind,
  IntegrationProvider,
  IntegrationReason,
  type IntegrationCardMeta,
} from "@/types/integration";

const FIGMA_DESIGN_URL_RE = /https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/[A-Za-z0-9_-]+/i;

export function containsFigmaDesignUrl(message: string): boolean {
  FIGMA_DESIGN_URL_RE.lastIndex = 0;
  return FIGMA_DESIGN_URL_RE.test(message);
}

export async function maybeAppendFigmaConnectionGate({
  ownerId,
  conversationId,
  message,
  locale,
}: {
  ownerId: string;
  conversationId: string;
  message: string;
  locale: AppLocale;
}): Promise<{ content: string; meta: IntegrationCardMeta } | null> {
  if (!containsFigmaDesignUrl(message)) return null;

  const status = await getFigmaConnectionStatus(ownerId);
  if (status.status === "connected") return null;

  const content = locale === "en"
    ? "Connect Figma before I can read this design link."
    : "需要连接 Figma 才能读取这个设计链接。";
  const meta: IntegrationCardMeta = {
    kind: IntegrationCardKind.IntegrationCard,
    provider: IntegrationProvider.Figma,
    action: IntegrationAction.Connect,
    reason: IntegrationReason.FigmaNotConnected,
    resume: { type: "conversation" },
  };

  await appendMessage(conversationId, {
    role: "assistant",
    content,
    model: AGENT_MODEL,
    meta,
  });

  return { content, meta };
}
