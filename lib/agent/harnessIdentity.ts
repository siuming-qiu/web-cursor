/**
 * [INPUT]: 显式 profile selection、locale/storage、最终 prompt、repository capability、完整有序 tools 与模型请求配置
 * [OUTPUT]: exact-version registry 解析、drift guard、canonical JSON 与版本化 AgentHarnessIdentity
 * [POS]: Agent 静态前缀协议的纯确定性 registry/resolver
 * [PROTOCOL]: 不查找 latest、不回退版本、不猜非法字段；对象 key 排序、数组保序，任何 profile digest 漂移都 fail closed
 */
import { createHash } from "node:crypto";
import { isAppLocale } from "@/i18n/locales";
import {
  ActiveAgentHarnessProfileSelection,
  AgentHarnessDigestAlgorithm,
  AgentHarnessIdentitySchemaVersion,
  AgentHarnessProfileId,
  AgentHarnessProfileKind,
  AgentHarnessProvider,
  AgentHarnessRenderingKey,
  AgentHarnessThinkingType,
  AgentHarnessToolChoice,
  AgentHarnessToolsetProfileVersion,
  type AgentHarnessIdentity,
  type AgentHarnessIdentityInput,
  type AgentHarnessModelRequestConfig,
  type AgentHarnessProfileKind as AgentHarnessProfileKindValue,
  type AgentHarnessProfileRef,
  type AgentHarnessProfileRegistry as AgentHarnessProfileRegistryValue,
  type AgentHarnessProfileSelection,
  type AgentHarnessVersionedProfile,
} from "@/types/agentHarness";
import { ProjectStorageKind } from "@/types/projectStorage";

type JsonObject = Record<string, unknown>;

export const AgentHarnessRegistryErrorCode = {
  UnknownProfileId: "AGENT_HARNESS_UNKNOWN_PROFILE_ID",
  UnknownProfileVersion: "AGENT_HARNESS_UNKNOWN_PROFILE_VERSION",
  DuplicateProfile: "AGENT_HARNESS_DUPLICATE_PROFILE",
  ProfileKindMismatch: "AGENT_HARNESS_PROFILE_KIND_MISMATCH",
  MissingExpectedDigest: "AGENT_HARNESS_MISSING_EXPECTED_DIGEST",
  DigestMismatch: "AGENT_HARNESS_DIGEST_MISMATCH",
} as const;

export type AgentHarnessRegistryErrorCode =
  typeof AgentHarnessRegistryErrorCode[keyof typeof AgentHarnessRegistryErrorCode];

export type AgentHarnessRegistryErrorContext = Readonly<{
  ref: AgentHarnessProfileRef;
  kind: AgentHarnessProfileKindValue;
  renderingKey?: AgentHarnessRenderingKey;
  expectedDigest?: string;
  actualDigest?: string;
}>;

export class AgentHarnessRegistryError extends Error {
  readonly code: AgentHarnessRegistryErrorCode;
  readonly context: AgentHarnessRegistryErrorContext;

  constructor(
    code: AgentHarnessRegistryErrorCode,
    message: string,
    context: AgentHarnessRegistryErrorContext,
  ) {
    super(`${code}: ${message}`);
    this.name = "AgentHarnessRegistryError";
    this.code = code;
    this.context = context;
  }
}

function frozenExpectedDigests(
  values: Record<AgentHarnessRenderingKey, string>,
): Readonly<Record<AgentHarnessRenderingKey, string>> {
  return Object.freeze(values);
}

/**
 * Registry 是发布协议的一部分。任何 prompt/tool/schema/model/capability 变更都必须：
 * 1. 新增 profile version；2. 写入该版本四种 locale×storage 渲染的固定 digest；
 * 3. 再把 ActiveAgentHarnessProfileSelection 指向新版本。
 */
export const AgentHarnessProfileRegistry: AgentHarnessProfileRegistryValue = Object.freeze([
  Object.freeze({
    kind: AgentHarnessProfileKind.SystemPrompt,
    ref: Object.freeze({
      id: AgentHarnessProfileId.SystemPrompt,
      version: 1,
    }),
    expectedDigestByRendering: frozenExpectedDigests({
      [AgentHarnessRenderingKey.ZhDatabase]:
        "f317dc9cfdc9fca24f1dcd5b595acee34557f7533b91f533157ab38acf0510c7",
      [AgentHarnessRenderingKey.ZhBrowserGit]:
        "bddd9cad8e5131a33ca88d27c96598e98d05a79ca5c8f6d3bd7ec3decbe3e7c3",
      [AgentHarnessRenderingKey.EnDatabase]:
        "bb3cdd0a4ed2200d2a32109ba0e4060eb01b8c21e1fd1b707e2f1ebdc9aea475",
      [AgentHarnessRenderingKey.EnBrowserGit]:
        "401b1a46fd21520ebbb611b64b2bfecad5e70efa46c008e97bcf99977139b1b3",
    }),
  }),
  Object.freeze({
    kind: AgentHarnessProfileKind.Toolset,
    ref: Object.freeze({
      id: AgentHarnessProfileId.Toolset,
      version: AgentHarnessToolsetProfileVersion.V1,
    }),
    expectedDigestByRendering: frozenExpectedDigests({
      [AgentHarnessRenderingKey.ZhDatabase]:
        "4d98ed158e0162f559359a4964c8e9ed0d26414dc3345464d593e9f37ce4eecf",
      [AgentHarnessRenderingKey.ZhBrowserGit]:
        "01ffef3f0f4127e74748c4b02c6eba783d38cc72b053c2ad618c816d84362257",
      [AgentHarnessRenderingKey.EnDatabase]:
        "4d98ed158e0162f559359a4964c8e9ed0d26414dc3345464d593e9f37ce4eecf",
      [AgentHarnessRenderingKey.EnBrowserGit]:
        "01ffef3f0f4127e74748c4b02c6eba783d38cc72b053c2ad618c816d84362257",
    }),
  }),
  Object.freeze({
    kind: AgentHarnessProfileKind.Toolset,
    ref: Object.freeze({
      id: AgentHarnessProfileId.Toolset,
      version: AgentHarnessToolsetProfileVersion.V2,
    }),
    expectedDigestByRendering: frozenExpectedDigests({
      [AgentHarnessRenderingKey.ZhDatabase]:
        "6f524c43f148f4b13cb1724ccfb07d6f1875de535ee9dcef7bddae43fda4fc2a",
      [AgentHarnessRenderingKey.ZhBrowserGit]:
        "182d6094d343af59f6727f4fc3bf55915a8fa91797c6dc7cf2802dbc7b497d49",
      [AgentHarnessRenderingKey.EnDatabase]:
        "6f524c43f148f4b13cb1724ccfb07d6f1875de535ee9dcef7bddae43fda4fc2a",
      [AgentHarnessRenderingKey.EnBrowserGit]:
        "182d6094d343af59f6727f4fc3bf55915a8fa91797c6dc7cf2802dbc7b497d49",
    }),
  }),
  Object.freeze({
    kind: AgentHarnessProfileKind.Model,
    ref: Object.freeze({
      id: AgentHarnessProfileId.Model,
      version: 1,
    }),
    expectedDigestByRendering: frozenExpectedDigests({
      [AgentHarnessRenderingKey.ZhDatabase]:
        "2e81f74474e96885e8f67ce5e9e09d70c266fc70776d92c13228a60efd0e853a",
      [AgentHarnessRenderingKey.ZhBrowserGit]:
        "2e81f74474e96885e8f67ce5e9e09d70c266fc70776d92c13228a60efd0e853a",
      [AgentHarnessRenderingKey.EnDatabase]:
        "2e81f74474e96885e8f67ce5e9e09d70c266fc70776d92c13228a60efd0e853a",
      [AgentHarnessRenderingKey.EnBrowserGit]:
        "2e81f74474e96885e8f67ce5e9e09d70c266fc70776d92c13228a60efd0e853a",
    }),
  }),
  Object.freeze({
    kind: AgentHarnessProfileKind.RepositoryCapability,
    ref: Object.freeze({
      id: AgentHarnessProfileId.RepositoryCapability,
      version: 1,
    }),
    expectedDigestByRendering: frozenExpectedDigests({
      [AgentHarnessRenderingKey.ZhDatabase]:
        "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
      [AgentHarnessRenderingKey.ZhBrowserGit]:
        "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
      [AgentHarnessRenderingKey.EnDatabase]:
        "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
      [AgentHarnessRenderingKey.EnBrowserGit]:
        "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
    }),
  }),
] satisfies AgentHarnessProfileRegistryValue);

function jsonError(path: string, detail: string): TypeError {
  return new TypeError(`Cannot canonicalize JSON at ${path}: ${detail}`);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactObjectKeys(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
): asserts value is JsonObject {
  if (!isJsonObject(value)) throw new TypeError(`${field} must be a plain object`);

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new TypeError(`${field} contains an unknown symbol key`);
  }
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new TypeError(
      `${field} must contain exactly: ${sortedExpectedKeys.join(", ")}`,
    );
  }
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || "get" in descriptor || "set" in descriptor) {
      throw new TypeError(`${field}.${key} must be an enumerable data property`);
    }
  }
}

function requireAllowedObjectKeys(
  value: unknown,
  allowedKeys: readonly string[],
  field: string,
): asserts value is JsonObject {
  if (!isJsonObject(value)) throw new TypeError(`${field} must be a plain object`);
  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new TypeError(`${field} contains an unknown key: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || "get" in descriptor || "set" in descriptor) {
      throw new TypeError(`${field}.${key} must be an enumerable data property`);
    }
  }
}

function requireDataProperty(
  value: object,
  key: PropertyKey,
  path: string,
): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) throw jsonError(path, "missing own property descriptor");
  if ("get" in descriptor || "set" in descriptor) {
    throw jsonError(path, "accessor properties are not JSON data");
  }
  return descriptor;
}

function canonicalizeArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
): string {
  const extraKey = Reflect.ownKeys(value).find((key) => {
    if (key === "length") return false;
    if (typeof key !== "string") return true;
    const index = Number(key);
    return !Number.isInteger(index) || index < 0 || String(index) !== key || index >= value.length;
  });
  if (extraKey !== undefined) {
    throw jsonError(path, "arrays cannot contain non-index own properties");
  }

  const items = Array.from({ length: value.length }, (_, index) => {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw jsonError(`${path}[${index}]`, "sparse array slots are not JSON values");
    }
    const descriptor = requireDataProperty(value, String(index), `${path}[${index}]`);
    return canonicalize(descriptor.value, `${path}[${index}]`, ancestors);
  });
  return `[${items.join(",")}]`;
}

function canonicalizeObject(value: JsonObject, path: string, ancestors: Set<object>): string {
  const keys = Reflect.ownKeys(value);
  const symbolKey = keys.find((key) => typeof key === "symbol");
  if (symbolKey !== undefined) throw jsonError(path, "symbol object keys are not JSON keys");

  const entries = (keys as string[])
    .sort()
    .map((key) => {
      const descriptor = requireDataProperty(value, key, `${path}.${key}`);
      if (!descriptor.enumerable) {
        throw jsonError(`${path}.${key}`, "non-enumerable properties are not JSON data");
      }
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors)}`;
    });
  return `{${entries.join(",")}}`;
}

function canonicalize(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw jsonError(path, "numbers must be finite");
      return JSON.stringify(value);
    case "undefined":
      throw jsonError(path, "undefined is not a JSON value");
    case "bigint":
    case "function":
    case "symbol":
      throw jsonError(path, `${typeof value} is not a JSON value`);
    case "object":
      break;
  }

  if (ancestors.has(value)) throw jsonError(path, "cyclic references are not supported");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) return canonicalizeArray(value, path, ancestors);
    if (!isJsonObject(value)) {
      throw jsonError(path, "only plain objects and arrays are supported");
    }
    return canonicalizeObject(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new Set());
}

export function sha256Digest(value: string): string {
  return createHash(AgentHarnessDigestAlgorithm.Sha256).update(value, "utf8").digest("hex");
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function requireKnownInput(input: AgentHarnessIdentityInput): void {
  requireExactObjectKeys(
    input,
    [
      "locale",
      "storageKind",
      "systemPrompt",
      "repositoryCapability",
      "tools",
      "request",
    ],
    "input",
  );
  if (!isAppLocale(input.locale)) {
    throw new TypeError(`Unknown agent harness locale: ${String(input.locale)}`);
  }
  if (
    input.storageKind !== ProjectStorageKind.Database
    && input.storageKind !== ProjectStorageKind.BrowserGit
  ) {
    throw new TypeError(`Unknown agent harness storage kind: ${String(input.storageKind)}`);
  }
  requireNonEmptyString(input.systemPrompt, "systemPrompt");
  requireNonEmptyString(input.repositoryCapability, "repositoryCapability");
  if (!Array.isArray(input.tools)) throw new TypeError("tools must be an array");
  requireModelRequest(input.request);
}

function requireModelRequest(request: AgentHarnessModelRequestConfig): void {
  requireExactObjectKeys(
    request,
    [
      "provider",
      "baseURL",
      "model",
      "stream",
      "toolChoice",
      "thinking",
      "extraGenerationParameters",
    ],
    "request",
  );
  if (request.provider !== AgentHarnessProvider.DeepSeek) {
    throw new TypeError(`Unknown agent harness provider: ${String(request.provider)}`);
  }
  requireNonEmptyString(request.baseURL, "request.baseURL");
  requireNonEmptyString(request.model, "request.model");
  if (request.stream !== true) {
    throw new TypeError(`Unknown agent harness stream value: ${String(request.stream)}`);
  }
  requireExactObjectKeys(request.thinking, ["type"], "request.thinking");
  if (request.thinking?.type !== AgentHarnessThinkingType.Disabled) {
    throw new TypeError(
      `Unknown agent harness thinking type: ${String(request.thinking?.type)}`,
    );
  }
  if (request.toolChoice !== AgentHarnessToolChoice.Auto) {
    throw new TypeError(
      `Unknown agent harness tool choice: ${String(request.toolChoice)}`,
    );
  }
  if (!isJsonObject(request.extraGenerationParameters)) {
    throw new TypeError("request.extraGenerationParameters must be a plain object");
  }
  if (Reflect.ownKeys(request.extraGenerationParameters).length !== 0) {
    throw new TypeError("request.extraGenerationParameters must be explicitly empty");
  }
}

function requireProfileRef(value: unknown, field: string): asserts value is AgentHarnessProfileRef {
  requireExactObjectKeys(value, ["id", "version"], field);
  requireNonEmptyString(value.id, `${field}.id`);
  if (
    typeof value.version !== "number"
    || !Number.isInteger(value.version)
    || value.version < 1
  ) {
    throw new TypeError(`${field}.version must be a positive integer`);
  }
}

function requireProfileSelection(
  selection: AgentHarnessProfileSelection,
): void {
  requireExactObjectKeys(
    selection,
    ["systemPrompt", "toolset", "model", "repositoryCapability"],
    "selection",
  );
  requireProfileRef(selection.systemPrompt, "selection.systemPrompt");
  requireProfileRef(selection.toolset, "selection.toolset");
  requireProfileRef(selection.model, "selection.model");
  requireProfileRef(
    selection.repositoryCapability,
    "selection.repositoryCapability",
  );
}

function toolName(tool: unknown, index: number): string {
  if (!isJsonObject(tool) || tool.type !== "function") {
    throw new TypeError(`tools[${index}] must be an OpenAI function tool`);
  }
  if (!isJsonObject(tool.function)) {
    throw new TypeError(`tools[${index}].function must be an object`);
  }

  const name = tool.function.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError(`tools[${index}].function.name must be a non-empty string`);
  }
  return name;
}

export function renderingKeyFor(
  locale: AgentHarnessIdentityInput["locale"],
  storageKind: AgentHarnessIdentityInput["storageKind"],
): AgentHarnessRenderingKey {
  return `${locale}:${storageKind}`;
}

function resolveProfile(
  registry: AgentHarnessProfileRegistryValue,
  kind: AgentHarnessProfileKindValue,
  ref: AgentHarnessProfileRef,
): AgentHarnessVersionedProfile {
  const profilesWithId = registry.filter((profile) => profile.ref.id === ref.id);
  if (profilesWithId.length === 0) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.UnknownProfileId,
      `Unknown agent harness profile id: ${ref.id}`,
      { ref, kind },
    );
  }

  const exactProfiles = profilesWithId.filter(
    (profile) => profile.ref.version === ref.version,
  );
  if (exactProfiles.length === 0) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.UnknownProfileVersion,
      `Unknown agent harness profile version: ${ref.id}@${ref.version}`,
      { ref, kind },
    );
  }
  if (exactProfiles.length > 1) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.DuplicateProfile,
      `Duplicate agent harness profile: ${ref.id}@${ref.version}`,
      { ref, kind },
    );
  }

  const profile = exactProfiles[0];
  if (profile.kind !== kind) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.ProfileKindMismatch,
      `Agent harness profile ${ref.id}@${ref.version} is ${profile.kind}, not ${kind}`,
      { ref, kind },
    );
  }
  return profile;
}

function assertExpectedDigest(
  profile: AgentHarnessVersionedProfile,
  renderingKey: AgentHarnessRenderingKey,
  actualDigest: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(profile.expectedDigestByRendering, renderingKey)) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.MissingExpectedDigest,
      `Missing expected digest for ${profile.ref.id}@${profile.ref.version} (${renderingKey})`,
      { ref: profile.ref, kind: profile.kind, renderingKey, actualDigest },
    );
  }

  const expectedDigest = profile.expectedDigestByRendering[renderingKey];
  if (expectedDigest !== actualDigest) {
    throw new AgentHarnessRegistryError(
      AgentHarnessRegistryErrorCode.DigestMismatch,
      `Agent harness profile digest mismatch: ${profile.ref.id}@${profile.ref.version} (${renderingKey})`,
      {
        ref: profile.ref,
        kind: profile.kind,
        renderingKey,
        expectedDigest,
        actualDigest,
      },
    );
  }
}

function copySelection(
  selection: AgentHarnessProfileSelection,
): AgentHarnessProfileSelection {
  return {
    systemPrompt: { ...selection.systemPrompt },
    toolset: { ...selection.toolset },
    model: { ...selection.model },
    repositoryCapability: { ...selection.repositoryCapability },
  };
}

function copyRequest(
  request: AgentHarnessModelRequestConfig,
): AgentHarnessModelRequestConfig {
  return {
    provider: request.provider,
    baseURL: request.baseURL,
    model: request.model,
    stream: request.stream,
    toolChoice: request.toolChoice,
    thinking: { type: request.thinking.type },
    extraGenerationParameters: {},
  };
}

function staticPrefixFor(
  input: AgentHarnessIdentityInput,
  selection: AgentHarnessProfileSelection,
  request: AgentHarnessModelRequestConfig,
) {
  return {
    schemaVersion: AgentHarnessIdentitySchemaVersion,
    digestAlgorithm: AgentHarnessDigestAlgorithm.Sha256,
    locale: input.locale,
    storageKind: input.storageKind,
    systemPrompt: {
      profile: selection.systemPrompt,
      content: input.systemPrompt,
    },
    toolset: {
      profile: selection.toolset,
      tools: input.tools,
    },
    model: {
      profile: selection.model,
      request,
    },
    repositoryCapability: {
      profile: selection.repositoryCapability,
      content: input.repositoryCapability,
    },
  };
}

export type ResolveAgentHarnessIdentityOptions = Readonly<{
  selection?: AgentHarnessProfileSelection;
  registry?: AgentHarnessProfileRegistryValue;
}>;

export function resolveAgentHarnessIdentity(
  input: AgentHarnessIdentityInput,
  options: ResolveAgentHarnessIdentityOptions = {},
): AgentHarnessIdentity {
  requireKnownInput(input);

  requireAllowedObjectKeys(options, ["selection", "registry"], "options");
  const selectedProfileRefs = options.selection === undefined
    ? ActiveAgentHarnessProfileSelection
    : options.selection;
  requireProfileSelection(selectedProfileRefs);
  const selection = copySelection(selectedProfileRefs);
  const registry = options.registry === undefined
    ? AgentHarnessProfileRegistry
    : options.registry;
  if (!Array.isArray(registry)) {
    throw new TypeError("registry must be an array");
  }
  const renderingKey = renderingKeyFor(input.locale, input.storageKind);
  const profiles = {
    systemPrompt: resolveProfile(
      registry,
      AgentHarnessProfileKind.SystemPrompt,
      selection.systemPrompt,
    ),
    toolset: resolveProfile(
      registry,
      AgentHarnessProfileKind.Toolset,
      selection.toolset,
    ),
    model: resolveProfile(
      registry,
      AgentHarnessProfileKind.Model,
      selection.model,
    ),
    repositoryCapability: resolveProfile(
      registry,
      AgentHarnessProfileKind.RepositoryCapability,
      selection.repositoryCapability,
    ),
  };

  const toolOrder = input.tools.map(toolName);
  const request = copyRequest(input.request);
  const digests = {
    systemPrompt: sha256Digest(input.systemPrompt),
    toolset: sha256Digest(canonicalJson(input.tools)),
    model: sha256Digest(canonicalJson(request)),
    repositoryCapability: sha256Digest(input.repositoryCapability),
  };

  assertExpectedDigest(profiles.systemPrompt, renderingKey, digests.systemPrompt);
  assertExpectedDigest(profiles.toolset, renderingKey, digests.toolset);
  assertExpectedDigest(profiles.model, renderingKey, digests.model);
  assertExpectedDigest(
    profiles.repositoryCapability,
    renderingKey,
    digests.repositoryCapability,
  );

  return {
    schemaVersion: AgentHarnessIdentitySchemaVersion,
    digestAlgorithm: AgentHarnessDigestAlgorithm.Sha256,
    locale: input.locale,
    storageKind: input.storageKind,
    selection,
    systemPrompt: {
      profileId: selection.systemPrompt.id,
      profileVersion: selection.systemPrompt.version,
      renderedDigest: digests.systemPrompt,
    },
    toolset: {
      profileId: selection.toolset.id,
      profileVersion: selection.toolset.version,
      toolOrder,
      schemaDigest: digests.toolset,
    },
    model: {
      profileId: selection.model.id,
      profileVersion: selection.model.version,
      request,
      configDigest: digests.model,
    },
    repositoryCapability: {
      profileId: selection.repositoryCapability.id,
      profileVersion: selection.repositoryCapability.version,
      renderedDigest: digests.repositoryCapability,
    },
    staticPrefixDigest: sha256Digest(
      canonicalJson(staticPrefixFor(input, selection, request)),
    ),
  };
}
