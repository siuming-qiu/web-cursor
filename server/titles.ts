/**
 * [INPUT]: 已完成的一轮用户需求与 assistant 最终输出
 * [OUTPUT]: 按需更新 projects/conversations.title
 * [POS]: A 域标题生成 —— assistant 完整回复后，用 LLM 生成短标题并持久化
 * [PROTOCOL]: 只补默认标题；失败或纯澄清则保持原值，不能用截断文本冒充理解。
 */
import "server-only";

import { eq } from "drizzle-orm";
import llmClient from "@/server/llm";
import { db } from "@/server/db";
import { conversations, projects } from "@/server/db/schema";
import { AGENT_MODEL } from "@/server/models";

const DEFAULT_TITLE = "untitled";
const MAX_CONTEXT_CHARS = 2400;
const MAX_TITLE_CHARS = 40;
type TitleUpdate = {
  title: string;
  projectTitle?: string;
  conversationTitle?: string;
};

function isDefaultTitle(title: string | null | undefined) {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === DEFAULT_TITLE;
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

async function generateTurnTitle(userMessage: string, assistantContent: string) {
  const assistantContext = normalizeContext(assistantContent);
  if (!assistantContext) return "";
  if (assistantContext.length <= 80 && /[?？]$/.test(assistantContext)) return "";

  const userContext = normalizeContext(userMessage);
  const response = await llmClient.chat.completions.create({
    model: AGENT_MODEL,
    temperature: 0.2,
    max_tokens: 128,
    messages: [
      {
        role: "system",
        content: [
          "你是会话标题生成器。",
          "根据用户需求和 assistant 已完成的实际输出，生成一个短、具体、用户友好的标题。",
          "规则：",
          "- 标题必须描述已经产出的内容，不要猜测用户下一步会做什么。",
          "- 中文 2-12 个字优先；英文 2-6 个词。",
          "- 不要输出 JSON、Markdown、引号、状态词、进度词。",
          "- 如果 assistant 只是澄清问题、闲聊或没有实质产出，只输出 SKIP。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `用户需求：${userContext.slice(0, 600)}`,
          `assistant 输出：${assistantContext.slice(0, MAX_CONTEXT_CHARS)}`,
        ].join("\n\n"),
      },
    ],
  });

  return cleanGeneratedTitle(response.choices[0]?.message?.content ?? "");
}

export async function updateGeneratedTitles(params: {
  conversationId: string;
  projectId?: string;
  userMessage: string;
  assistantContent: string;
}) {
  const [conversation] = await db
    .select({ title: conversations.title, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);

  if (!conversation) return null;

  const projectId = params.projectId ?? conversation.projectId;
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!isDefaultTitle(conversation.title) && !isDefaultTitle(project?.title)) return null;

  const title = await generateTurnTitle(params.userMessage, params.assistantContent);
  if (!title) return null;

  const result: TitleUpdate = { title };

  if (isDefaultTitle(conversation.title)) {
    await db
      .update(conversations)
      .set({ title })
      .where(eq(conversations.id, params.conversationId));
    result.conversationTitle = title;
  }

  if (project && isDefaultTitle(project.title)) {
    await db
      .update(projects)
      .set({ title, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    result.projectTitle = title;
  }

  return result;
}
