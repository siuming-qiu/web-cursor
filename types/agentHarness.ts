/**
 * [INPUT]: Persisted Agent harness identity JSON and versioned profile constants
 * [OUTPUT]: Strict identity/selection schemas plus shared harness identity types
 * [POS]: Cross-domain persisted AgentRun harness contract
 * [PROTOCOL]: Reject unknown fields and unknown finite values; digests are exactly 64 lowercase hex characters
 */
import { z } from "zod";
import { locales, type AppLocale } from "@/i18n/locales";
import {
  ProjectStorageKind,
  ProjectStorageKindSchema,
  type ProjectStorageKind as ProjectStorageKindValue,
} from "@/types/projectStorage";

export const AgentHarnessIdentitySchemaVersion = 1 as const;

export const AgentHarnessDigestAlgorithm = {
  Sha256: "sha256",
} as const;

export type AgentHarnessDigestAlgorithm =
  typeof AgentHarnessDigestAlgorithm[keyof typeof AgentHarnessDigestAlgorithm];

export const AgentHarnessProfileKind = {
  SystemPrompt: "system_prompt",
  Toolset: "toolset",
  Model: "model",
  RepositoryCapability: "repository_capability",
} as const;

export type AgentHarnessProfileKind =
  typeof AgentHarnessProfileKind[keyof typeof AgentHarnessProfileKind];

export const AgentHarnessProfileId = {
  SystemPrompt: "web-cursor.agent.system-prompt",
  Toolset: "web-cursor.agent.toolset",
  Model: "web-cursor.agent.model",
  RepositoryCapability: "web-cursor.agent.repository-capability",
} as const;

export type AgentHarnessProfileId =
  typeof AgentHarnessProfileId[keyof typeof AgentHarnessProfileId];

export const AgentHarnessToolsetProfileVersion = {
  V1: 1,
  V2: 2,
} as const;

export type AgentHarnessToolsetProfileVersion =
  typeof AgentHarnessToolsetProfileVersion[keyof typeof AgentHarnessToolsetProfileVersion];

export const AgentHarnessProfileVersion = {
  SystemPrompt: 1,
  Toolset: AgentHarnessToolsetProfileVersion.V2,
  Model: 1,
  RepositoryCapability: 1,
} as const;

export type AgentHarnessProfileRef<TId extends string = AgentHarnessProfileId> = Readonly<{
  id: TId;
  version: number;
}>;

export type AgentHarnessProfileSelection = Readonly<{
  systemPrompt: AgentHarnessProfileRef<typeof AgentHarnessProfileId.SystemPrompt>;
  toolset: AgentHarnessProfileRef<typeof AgentHarnessProfileId.Toolset>;
  model: AgentHarnessProfileRef<typeof AgentHarnessProfileId.Model>;
  repositoryCapability: AgentHarnessProfileRef<
    typeof AgentHarnessProfileId.RepositoryCapability
  >;
}>;

const AgentHarnessSystemPromptProfileRefSchema = z.object({
  id: z.literal(AgentHarnessProfileId.SystemPrompt),
  version: z.number().int().positive(),
}).strict();

const AgentHarnessToolsetProfileRefSchema = z.object({
  id: z.literal(AgentHarnessProfileId.Toolset),
  version: z.number().int().positive(),
}).strict();

const AgentHarnessModelProfileRefSchema = z.object({
  id: z.literal(AgentHarnessProfileId.Model),
  version: z.number().int().positive(),
}).strict();

const AgentHarnessRepositoryCapabilityProfileRefSchema = z.object({
  id: z.literal(AgentHarnessProfileId.RepositoryCapability),
  version: z.number().int().positive(),
}).strict();

export const AgentHarnessProfileSelectionSchema = z.object({
  systemPrompt: AgentHarnessSystemPromptProfileRefSchema,
  toolset: AgentHarnessToolsetProfileRefSchema,
  model: AgentHarnessModelProfileRefSchema,
  repositoryCapability: AgentHarnessRepositoryCapabilityProfileRefSchema,
}).strict();

/**
 * 新 Run 必须显式选择这一组 ref；未来恢复旧 Run 时传入该 Run 已持久化的 selection，
 * 不得把缺失版本自动替换成这里的 active 版本。
 */
export const ActiveAgentHarnessProfileSelection = {
  systemPrompt: {
    id: AgentHarnessProfileId.SystemPrompt,
    version: AgentHarnessProfileVersion.SystemPrompt,
  },
  toolset: {
    id: AgentHarnessProfileId.Toolset,
    version: AgentHarnessProfileVersion.Toolset,
  },
  model: {
    id: AgentHarnessProfileId.Model,
    version: AgentHarnessProfileVersion.Model,
  },
  repositoryCapability: {
    id: AgentHarnessProfileId.RepositoryCapability,
    version: AgentHarnessProfileVersion.RepositoryCapability,
  },
} as const satisfies AgentHarnessProfileSelection;

export const AgentHarnessThinkingType = {
  Disabled: "disabled",
} as const;

export type AgentHarnessThinking = Readonly<{
  type: typeof AgentHarnessThinkingType.Disabled;
}>;

export const AgentHarnessToolChoice = {
  Auto: "auto",
} as const;

export type AgentHarnessToolChoice =
  typeof AgentHarnessToolChoice[keyof typeof AgentHarnessToolChoice];

export const AgentHarnessProvider = {
  DeepSeek: "deepseek",
} as const;

export type AgentHarnessProvider =
  typeof AgentHarnessProvider[keyof typeof AgentHarnessProvider];

export type AgentHarnessModelRequestConfig = Readonly<{
  provider: AgentHarnessProvider;
  baseURL: string;
  model: string;
  stream: true;
  toolChoice: AgentHarnessToolChoice;
  thinking: AgentHarnessThinking;
  /**
   * 动态 messages/tools 不属于生成参数。当前 Route 没有 temperature、top_p 等额外参数，
   * 因此必须显式记录为空对象，不能把“缺失”解释成某个 provider 默认值。
   */
  extraGenerationParameters: Readonly<Record<string, never>>;
}>;

export const AgentHarnessRenderingKey = {
  ZhDatabase: `zh:${ProjectStorageKind.Database}`,
  ZhBrowserGit: `zh:${ProjectStorageKind.BrowserGit}`,
  EnDatabase: `en:${ProjectStorageKind.Database}`,
  EnBrowserGit: `en:${ProjectStorageKind.BrowserGit}`,
} as const;

export type AgentHarnessRenderingKey =
  typeof AgentHarnessRenderingKey[keyof typeof AgentHarnessRenderingKey];

export type AgentHarnessVersionedProfile = Readonly<{
  kind: AgentHarnessProfileKind;
  ref: AgentHarnessProfileRef;
  expectedDigestByRendering: Readonly<Record<AgentHarnessRenderingKey, string>>;
}>;

export type AgentHarnessProfileRegistry = readonly AgentHarnessVersionedProfile[];

export type AgentHarnessSystemPromptIdentity = Readonly<{
  profileId: typeof AgentHarnessProfileId.SystemPrompt;
  profileVersion: number;
  renderedDigest: string;
}>;

export type AgentHarnessToolsetIdentity = Readonly<{
  profileId: typeof AgentHarnessProfileId.Toolset;
  profileVersion: number;
  toolOrder: readonly string[];
  schemaDigest: string;
}>;

export type AgentHarnessModelIdentity = Readonly<{
  profileId: typeof AgentHarnessProfileId.Model;
  profileVersion: number;
  request: AgentHarnessModelRequestConfig;
  configDigest: string;
}>;

export type AgentHarnessRepositoryCapabilityIdentity = Readonly<{
  profileId: typeof AgentHarnessProfileId.RepositoryCapability;
  profileVersion: number;
  renderedDigest: string;
}>;

export type AgentHarnessIdentity = Readonly<{
  schemaVersion: typeof AgentHarnessIdentitySchemaVersion;
  digestAlgorithm: typeof AgentHarnessDigestAlgorithm.Sha256;
  locale: AppLocale;
  storageKind: ProjectStorageKindValue;
  selection: AgentHarnessProfileSelection;
  systemPrompt: AgentHarnessSystemPromptIdentity;
  toolset: AgentHarnessToolsetIdentity;
  model: AgentHarnessModelIdentity;
  repositoryCapability: AgentHarnessRepositoryCapabilityIdentity;
  staticPrefixDigest: string;
}>;

const AgentHarnessDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

const AgentHarnessThinkingSchema = z.object({
  type: z.literal(AgentHarnessThinkingType.Disabled),
}).strict();

const AgentHarnessModelRequestConfigSchema = z.object({
  provider: z.enum(AgentHarnessProvider),
  baseURL: z.string().min(1),
  model: z.string().min(1),
  stream: z.literal(true),
  toolChoice: z.enum(AgentHarnessToolChoice),
  thinking: AgentHarnessThinkingSchema,
  extraGenerationParameters: z.object({}).strict(),
}).strict();

const AgentHarnessSystemPromptIdentitySchema = z.object({
  profileId: z.literal(AgentHarnessProfileId.SystemPrompt),
  profileVersion: z.number().int().positive(),
  renderedDigest: AgentHarnessDigestSchema,
}).strict();

const AgentHarnessToolsetIdentitySchema = z.object({
  profileId: z.literal(AgentHarnessProfileId.Toolset),
  profileVersion: z.number().int().positive(),
  toolOrder: z.array(z.string().min(1)),
  schemaDigest: AgentHarnessDigestSchema,
}).strict();

const AgentHarnessModelIdentitySchema = z.object({
  profileId: z.literal(AgentHarnessProfileId.Model),
  profileVersion: z.number().int().positive(),
  request: AgentHarnessModelRequestConfigSchema,
  configDigest: AgentHarnessDigestSchema,
}).strict();

const AgentHarnessRepositoryCapabilityIdentitySchema = z.object({
  profileId: z.literal(AgentHarnessProfileId.RepositoryCapability),
  profileVersion: z.number().int().positive(),
  renderedDigest: AgentHarnessDigestSchema,
}).strict();

export const AgentHarnessIdentitySchema = z.object({
  schemaVersion: z.literal(AgentHarnessIdentitySchemaVersion),
  digestAlgorithm: z.literal(AgentHarnessDigestAlgorithm.Sha256),
  locale: z.enum(locales),
  storageKind: ProjectStorageKindSchema,
  selection: AgentHarnessProfileSelectionSchema,
  systemPrompt: AgentHarnessSystemPromptIdentitySchema,
  toolset: AgentHarnessToolsetIdentitySchema,
  model: AgentHarnessModelIdentitySchema,
  repositoryCapability: AgentHarnessRepositoryCapabilityIdentitySchema,
  staticPrefixDigest: AgentHarnessDigestSchema,
}).strict();

export type AgentHarnessIdentityInput = Readonly<{
  locale: AppLocale;
  storageKind: ProjectStorageKindValue;
  systemPrompt: string;
  repositoryCapability: string;
  tools: readonly unknown[];
  request: AgentHarnessModelRequestConfig;
}>;
