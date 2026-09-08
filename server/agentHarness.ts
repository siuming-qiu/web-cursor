/**
 * [INPUT]: AppLocale、ProjectStorageKind、明确 profile selection 或持久化 AgentHarnessIdentity
 * [OUTPUT]: 同源生成/严格恢复的 identity、system prompt、tools 与完整模型请求配置
 * [POS]: A 域 Agent 静态前缀装配器与 AgentRun resume identity gate
 * [PROTOCOL]: exact profile/version、digest、canonical identity 任一不匹配立即失败；不 fallback/迁移
 */
import "server-only";
import type { AppLocale } from "@/i18n/locales";
import {
  canonicalJson,
  resolveAgentHarnessIdentity,
} from "@/lib/agent/harnessIdentity";
import {
  repositoryCapabilityPromptForStorageKind,
  systemPromptForLocale,
} from "@/server/llm";
import { AGENT_MODEL_REQUEST_CONFIG } from "@/server/models";
import { toolsForStorageKind } from "@/server/tools/definitions";
import {
  ActiveAgentHarnessProfileSelection,
  AgentHarnessIdentitySchema,
  type AgentHarnessProfileSelection,
} from "@/types/agentHarness";
import type { ProjectStorageKind } from "@/types/projectStorage";

export const AgentHarnessRestoreErrorCode = {
  IdentityMismatch: "AGENT_HARNESS_IDENTITY_MISMATCH",
} as const;

export class AgentHarnessRestoreError extends Error {
  readonly code = AgentHarnessRestoreErrorCode.IdentityMismatch;

  constructor() {
    super(
      `${AgentHarnessRestoreErrorCode.IdentityMismatch}: `
      + "persisted identity differs from exact registry reconstruction",
    );
    this.name = "AgentHarnessRestoreError";
  }
}

export function agentHarnessFor(
  locale: AppLocale,
  storageKind: ProjectStorageKind,
  selection: AgentHarnessProfileSelection =
    ActiveAgentHarnessProfileSelection,
) {
  const systemPrompt = systemPromptForLocale(locale, storageKind);
  const repositoryCapability = repositoryCapabilityPromptForStorageKind(storageKind);
  const tools = toolsForStorageKind(storageKind, selection.toolset.version);
  const request = AGENT_MODEL_REQUEST_CONFIG;
  const identity = resolveAgentHarnessIdentity({
    locale,
    storageKind,
    systemPrompt,
    repositoryCapability,
    tools,
    request,
  }, {
    selection,
  });

  return {
    identity,
    systemPrompt,
    tools,
    model: request.model,
    stream: request.stream,
    thinking: request.thinking,
    toolChoice: request.toolChoice,
  };
}

export function restoreAgentHarness(identity: unknown) {
  const persistedIdentity = AgentHarnessIdentitySchema.parse(identity);
  const harness = agentHarnessFor(
    persistedIdentity.locale,
    persistedIdentity.storageKind,
    persistedIdentity.selection,
  );

  if (
    canonicalJson(harness.identity)
    !== canonicalJson(persistedIdentity)
  ) {
    throw new AgentHarnessRestoreError();
  }

  return harness;
}
