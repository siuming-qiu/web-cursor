/**
 * [INPUT]: 用户首轮需求文本 + 当前 agent 请求取消信号
 * [OUTPUT]: 按需更新 projects/conversations.title
 * [POS]: A 域标题生成 —— 新会话先用用户首句做 fallback，再用 LLM refine
 * [PROTOCOL]: 只更新默认标题或当前首句 fallback 标题；不覆盖用户/历史明确标题。
 */
import "server-only";

import { eq } from "drizzle-orm";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import llmClient from "@/server/llm";
import { db } from "@/server/db";
import { conversations, projects } from "@/server/db/schema";
import { TITLE_MODEL } from "@/server/models";

const DEFAULT_TITLE = "untitled";
const FALLBACK_TITLE_CHARS = 40;
const MAX_TITLE_CHARS = 40;
type DeepSeekNonStreamingParams = ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: "disabled" };
};
type TitleUpdate = {
  title: string;
  projectTitle?: string;
  conversationTitle?: string;
};

function isDefaultTitle(title: string | null | undefined) {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === DEFAULT_TITLE;
}

function normalizeTitleSource(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeInitialTitle(userMessage: string) {
  const normalized = normalizeTitleSource(userMessage);
  if (!normalized) return DEFAULT_TITLE;
  return normalized.length > FALLBACK_TITLE_CHARS
    ? `${normalized.slice(0, FALLBACK_TITLE_CHARS)}...`
    : normalized;
}

function normalizeContext(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanGeneratedTitle(input: string) {
  const title = input.trim();
  if (!title || title.toUpperCase() === "SKIP") return "";
  if (title.includes("\n") || title.length > MAX_TITLE_CHARS) return "";
  return title;
}

async function generateUserMessageTitle(userMessage: string, signal: AbortSignal) {
  const userContext = normalizeContext(userMessage);
  if (!userContext) return "";

  const params: DeepSeekNonStreamingParams = {
    model: TITLE_MODEL,
    temperature: 0.2,
    max_tokens: 128,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "system",
        content: [
          "你是会话标题生成器。",
          "根据用户第一句话，生成一个短、具体、用户友好的项目/会话标题。",
          "规则：",
          "- 标题描述用户想创建、修改或分析的对象。",
          "- 中文 2-12 个字优先；英文 2-6 个词。",
          "- 不要输出 JSON、Markdown、引号、状态词、进度词。",
          "- 如果用户只是闲聊、问候或没有明确任务，只输出 SKIP。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `用户第一句话：${userContext.slice(0, 600)}`,
      },
    ],
  };

  const response = await llmClient.chat.completions.create(params, { signal });

  return cleanGeneratedTitle(response.choices[0]?.message?.content ?? "");
}

function canRefineTitle(current: string | null | undefined, fallbackTitle: string) {
  const normalized = current?.trim();
  return isDefaultTitle(normalized) || normalized === fallbackTitle;
}

export async function updateGeneratedTitlesFromUserMessage(params: {
  conversationId: string;
  projectId?: string;
  userMessage: string;
  signal: AbortSignal;
}) {
  const [conversation] = await db
    .select({ title: conversations.title, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);

  if (!conversation) return null;

  const fallbackTitle = makeInitialTitle(params.userMessage);
  const projectId = params.projectId ?? conversation.projectId;
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const shouldUpdateConversation = canRefineTitle(conversation.title, fallbackTitle);
  const shouldUpdateProject = project ? canRefineTitle(project.title, fallbackTitle) : false;
  if (!shouldUpdateConversation && !shouldUpdateProject) return null;

  const title = await generateUserMessageTitle(params.userMessage, params.signal);
  params.signal.throwIfAborted();
  if (!title) return null;
  if (title === fallbackTitle) return null;

  const result: TitleUpdate = { title };

  if (shouldUpdateConversation) {
    await db
      .update(conversations)
      .set({ title })
      .where(eq(conversations.id, params.conversationId));
    result.conversationTitle = title;
  }

  if (project && shouldUpdateProject) {
    await db
      .update(projects)
      .set({ title, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    result.projectTitle = title;
  }

  return result;
}
