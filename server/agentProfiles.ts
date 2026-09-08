/**
 * [INPUT]: strict Sub-agent profile id, locale, and repository storage kind
 * [OUTPUT]: read-only Child harness plus an execution-time allowed-tool gate
 * [POS]: A domain Sub-agent Profile registry; profiles configure the shared Runner, never replace it
 * [PROTOCOL]: unknown profiles/storage fail closed; model-visible tools and executor allowlist must stay identical
 */
import "server-only";
import type { AppLocale } from "@/i18n/locales";
import { AGENT_MODEL_REQUEST_CONFIG } from "@/server/models";
import { toolsForStorageKind } from "@/server/tools/definitions";
import { AgentHarnessToolsetProfileVersion } from "@/types/agentHarness";
import { ProjectStorageKind, type ProjectStorageKind as ProjectStorageKindValue } from "@/types/projectStorage";
import { SubagentProfileId, type SubagentProfileId as SubagentProfileIdValue } from "@/types/subagent";
import { ToolName, type ToolName as ToolNameValue } from "@/types/tool";

export const SubagentProfileErrorCode = {
  UnknownProfile: "SUBAGENT_UNKNOWN_PROFILE",
  UnsupportedStorage: "SUBAGENT_UNSUPPORTED_STORAGE",
  InvalidToolset: "SUBAGENT_INVALID_TOOLSET",
} as const;

export type SubagentProfileErrorCode =
  typeof SubagentProfileErrorCode[keyof typeof SubagentProfileErrorCode];

export class SubagentProfileError extends Error {
  constructor(
    readonly code: SubagentProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubagentProfileError";
  }
}

const EXPLORER_ALLOWED_TOOLS = [
  ToolName.ListFiles,
  ToolName.SearchText,
  ToolName.ReadFile,
] as const satisfies readonly ToolNameValue[];

const EXPLORER_SYSTEM_PROMPT: Record<AppLocale, string> = {
  zh: `你是 Web Cursor 的 Explorer Child Agent。

你的任务是独立调查 Parent Agent 交给你的代码问题，并返回准确、可引用的代码事实。

规则：
- 你只能读取项目，不能修改文件、运行预览、生成图片或执行 Git mutation。
- 不知道结构时先调用 list_files；定位符号或文本时调用 search_text；引用实现前调用 read_file 读取完整文件。
- 不得猜测未读取的文件内容，不得声称执行了未提供的工具。
- 调查完成后，用简洁中文返回结论、依据文件和关键实现关系。`,
  en: `You are Web Cursor's Explorer Child Agent.

Independently investigate the code question delegated by the Parent Agent and return precise, attributable code facts.

Rules:
- Read only. Do not modify files, run previews, generate images, or perform Git mutations.
- Use list_files to learn structure, search_text to locate symbols or text, and read_file before citing an implementation.
- Never guess unread file contents or claim tools that were not provided.
- Return a concise English conclusion with source files and the key implementation relationships.`,
};

const EXPLORER_RUNTIME_BUDGET: Record<AppLocale, Readonly<{
  softModelRounds: number;
  maxModelRounds: number;
  convergenceMessage: string;
}>> = {
  zh: {
    softModelRounds: 24,
    maxModelRounds: 32,
    convergenceMessage: `你的执行预算即将耗尽。停止扩大调查范围，根据已经获得的证据整理最终结论。
只允许继续读取完成结论所必需的关键文件，并在剩余轮次内返回报告。`,
  },
  en: {
    softModelRounds: 24,
    maxModelRounds: 32,
    convergenceMessage: `Your execution budget is nearly exhausted. Stop expanding the investigation and synthesize the final conclusion from the evidence already collected.
Only read files required to close critical evidence gaps, then return the report within the remaining rounds.`,
  },
};

export type ResolvedSubagentProfile = Readonly<{
  id: typeof SubagentProfileId.Explorer;
  systemPrompt: string;
  allowedTools: ReadonlySet<string>;
  model: typeof AGENT_MODEL_REQUEST_CONFIG.model;
  tools: ReturnType<typeof toolsForStorageKind>;
  toolChoice: typeof AGENT_MODEL_REQUEST_CONFIG.toolChoice;
  stream: typeof AGENT_MODEL_REQUEST_CONFIG.stream;
  thinking: typeof AGENT_MODEL_REQUEST_CONFIG.thinking;
  runtimeBudget: Readonly<{
    softModelRounds: number;
    maxModelRounds: number;
    convergenceMessage: string;
  }>;
}>;

function explorerTools() {
  const allowed = new Set<string>(EXPLORER_ALLOWED_TOOLS);
  const tools = toolsForStorageKind(
    ProjectStorageKind.Database,
    AgentHarnessToolsetProfileVersion.V1,
  ).filter((tool) => allowed.has(tool.function.name));

  if (
    tools.length !== EXPLORER_ALLOWED_TOOLS.length
    || tools.some((tool, index) => tool.function.name !== EXPLORER_ALLOWED_TOOLS[index])
  ) {
    throw new SubagentProfileError(
      SubagentProfileErrorCode.InvalidToolset,
      "Explorer tool definitions do not match its execution allowlist.",
    );
  }
  return tools;
}

export function resolveSubagentProfile(input: {
  profileId: SubagentProfileIdValue;
  locale: AppLocale;
  storageKind: ProjectStorageKindValue;
}): ResolvedSubagentProfile {
  if (input.profileId !== SubagentProfileId.Explorer) {
    throw new SubagentProfileError(
      SubagentProfileErrorCode.UnknownProfile,
      `Unknown Sub-agent profile: ${String(input.profileId)}`,
    );
  }
  if (input.storageKind !== ProjectStorageKind.Database) {
    throw new SubagentProfileError(
      SubagentProfileErrorCode.UnsupportedStorage,
      "Explorer Child currently supports only Database repositories.",
    );
  }

  return {
    id: SubagentProfileId.Explorer,
    systemPrompt: EXPLORER_SYSTEM_PROMPT[input.locale],
    allowedTools: new Set(EXPLORER_ALLOWED_TOOLS),
    model: AGENT_MODEL_REQUEST_CONFIG.model,
    tools: explorerTools(),
    toolChoice: AGENT_MODEL_REQUEST_CONFIG.toolChoice,
    stream: AGENT_MODEL_REQUEST_CONFIG.stream,
    thinking: AGENT_MODEL_REQUEST_CONFIG.thinking,
    runtimeBudget: EXPLORER_RUNTIME_BUDGET[input.locale],
  };
}
