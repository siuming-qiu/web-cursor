import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DEEPSEEK_API_KEY = "unit-test-placeholder";
});
vi.mock("server-only", () => ({}));

import {
  AgentHarnessProfileRegistry,
  AgentHarnessRegistryError,
  AgentHarnessRegistryErrorCode,
  canonicalJson,
  resolveAgentHarnessIdentity,
} from "../../lib/agent/harnessIdentity";
import {
  ActiveAgentHarnessProfileSelection,
  AgentHarnessProfileId,
  AgentHarnessProfileKind,
  AgentHarnessProvider,
  AgentHarnessRenderingKey,
  AgentHarnessThinkingType,
  AgentHarnessToolChoice,
  AgentHarnessToolsetProfileVersion,
  type AgentHarnessIdentityInput,
  type AgentHarnessProfileRegistry as AgentHarnessProfileRegistryValue,
  type AgentHarnessProfileSelection,
} from "../../types/agentHarness";
import { ProjectStorageKind } from "../../types/projectStorage";

type AgentHarnessServerModule = typeof import("../../server/agentHarness");
type LlmServerModule = typeof import("../../server/llm");
type ModelServerModule = typeof import("../../server/models");
type ToolDefinitionsServerModule = typeof import("../../server/tools/definitions");

let agentHarnessFor: AgentHarnessServerModule["agentHarnessFor"];
let restoreAgentHarness: AgentHarnessServerModule["restoreAgentHarness"];
let repositoryCapabilityPromptForStorageKind:
  LlmServerModule["repositoryCapabilityPromptForStorageKind"];
let systemPromptForLocale: LlmServerModule["systemPromptForLocale"];
let agentModelRequestConfig: ModelServerModule["AGENT_MODEL_REQUEST_CONFIG"];
let toolsForStorageKind: ToolDefinitionsServerModule["toolsForStorageKind"];

beforeAll(async () => {
  ({ agentHarnessFor, restoreAgentHarness } = await import("../../server/agentHarness"));
  ({
    repositoryCapabilityPromptForStorageKind,
    systemPromptForLocale,
  } = await import("../../server/llm"));
  ({ AGENT_MODEL_REQUEST_CONFIG: agentModelRequestConfig } = await import(
    "../../server/models"
  ));
  ({ toolsForStorageKind } = await import("../../server/tools/definitions"));
});

const legacyV1RenderingCases = [
  {
    locale: "zh",
    storageKind: ProjectStorageKind.Database,
    systemPromptDigest: "f317dc9cfdc9fca24f1dcd5b595acee34557f7533b91f533157ab38acf0510c7",
    toolsetDigest: "4d98ed158e0162f559359a4964c8e9ed0d26414dc3345464d593e9f37ce4eecf",
    repositoryCapabilityDigest:
      "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
    staticPrefixDigest:
      "b816d53b33249211f9bf9f7524543d3abf951a1d48efc3f4e1141fddb2979e36",
  },
  {
    locale: "zh",
    storageKind: ProjectStorageKind.BrowserGit,
    systemPromptDigest: "bddd9cad8e5131a33ca88d27c96598e98d05a79ca5c8f6d3bd7ec3decbe3e7c3",
    toolsetDigest: "01ffef3f0f4127e74748c4b02c6eba783d38cc72b053c2ad618c816d84362257",
    repositoryCapabilityDigest:
      "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
    staticPrefixDigest:
      "b12ba38cba7a5897a13bf66ce92cc453e2fe6a4fb99162fee5f48d17bd81a6e7",
  },
  {
    locale: "en",
    storageKind: ProjectStorageKind.Database,
    systemPromptDigest: "bb3cdd0a4ed2200d2a32109ba0e4060eb01b8c21e1fd1b707e2f1ebdc9aea475",
    toolsetDigest: "4d98ed158e0162f559359a4964c8e9ed0d26414dc3345464d593e9f37ce4eecf",
    repositoryCapabilityDigest:
      "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
    staticPrefixDigest:
      "ebd1338bd93a174c44d5948e3d6722bb0ac8c12ef5182e9733b0a49156132319",
  },
  {
    locale: "en",
    storageKind: ProjectStorageKind.BrowserGit,
    systemPromptDigest: "401b1a46fd21520ebbb611b64b2bfecad5e70efa46c008e97bcf99977139b1b3",
    toolsetDigest: "01ffef3f0f4127e74748c4b02c6eba783d38cc72b053c2ad618c816d84362257",
    repositoryCapabilityDigest:
      "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
    staticPrefixDigest:
      "66503b60e509f83d2c7c4135df23f52dd72cb67fc85b6fda650c82d6b60382fb",
  },
] as const;

const activeRenderingCases = [
  {
    locale: "zh",
    storageKind: ProjectStorageKind.Database,
    systemPromptDigest: "f317dc9cfdc9fca24f1dcd5b595acee34557f7533b91f533157ab38acf0510c7",
    toolsetDigest: "6f524c43f148f4b13cb1724ccfb07d6f1875de535ee9dcef7bddae43fda4fc2a",
    repositoryCapabilityDigest:
      "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
    staticPrefixDigest:
      "bbc5170cc2df57b8ef3fbe0a78c9deb286caeebe88d976b5878cc1adc1417201",
  },
  {
    locale: "zh",
    storageKind: ProjectStorageKind.BrowserGit,
    systemPromptDigest: "bddd9cad8e5131a33ca88d27c96598e98d05a79ca5c8f6d3bd7ec3decbe3e7c3",
    toolsetDigest: "182d6094d343af59f6727f4fc3bf55915a8fa91797c6dc7cf2802dbc7b497d49",
    repositoryCapabilityDigest:
      "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
    staticPrefixDigest:
      "19db664801f31e824977fd19bb51cfb5bbf84ea4e41f5504d65f21c74001ecd7",
  },
  {
    locale: "en",
    storageKind: ProjectStorageKind.Database,
    systemPromptDigest: "bb3cdd0a4ed2200d2a32109ba0e4060eb01b8c21e1fd1b707e2f1ebdc9aea475",
    toolsetDigest: "6f524c43f148f4b13cb1724ccfb07d6f1875de535ee9dcef7bddae43fda4fc2a",
    repositoryCapabilityDigest:
      "b2d0e79db83453223b26d1fd53792ae2bd813f3fa6b7fd33ae2220913bf9d45e",
    staticPrefixDigest:
      "363d6011c08b418493c55962d7794aa2de5d2d1d245ba53bbe93df717019cbac",
  },
  {
    locale: "en",
    storageKind: ProjectStorageKind.BrowserGit,
    systemPromptDigest: "401b1a46fd21520ebbb611b64b2bfecad5e70efa46c008e97bcf99977139b1b3",
    toolsetDigest: "182d6094d343af59f6727f4fc3bf55915a8fa91797c6dc7cf2802dbc7b497d49",
    repositoryCapabilityDigest:
      "6e6865ccca91f9c6c5cf053f7523571d2290afdbc29479e517edf30420e30582",
    staticPrefixDigest:
      "4c68e7da21fc9067a0f740d1f9faae48453aa2d32d20f4d1b93d15500f8181ef",
  },
] as const;

const modelConfigDigest =
  "2e81f74474e96885e8f67ce5e9e09d70c266fc70776d92c13228a60efd0e853a";

const v1BaseToolOrder = [
  "list_files",
  "search_text",
  "read_file",
  "write_file",
  "delete_file",
  "rename_file",
  "run_preview",
  "inspect_attachment",
  "inspect_figma_design",
  "generate_image",
] as const;

const subagentControlToolOrder = [
  "spawn_agent",
  "wait_agent",
  "send_message",
  "followup_task",
  "interrupt_agent",
] as const;

const activeDatabaseToolOrder = [
  ...v1BaseToolOrder,
  ...subagentControlToolOrder,
] as const;

const v1BrowserGitToolOrder = [
  ...v1BaseToolOrder,
  "git_status",
  "git_stage",
  "git_unstage",
  "git_commit",
  "git_log",
  "git_current_branch",
] as const;

const activeBrowserGitToolOrder = [
  ...v1BrowserGitToolOrder,
  ...subagentControlToolOrder,
] as const;

const legacyV1Selection = {
  ...ActiveAgentHarnessProfileSelection,
  toolset: {
    id: AgentHarnessProfileId.Toolset,
    version: AgentHarnessToolsetProfileVersion.V1,
  },
} as const satisfies AgentHarnessProfileSelection;

function identityInput(
  locale: "zh" | "en" = "zh",
  storageKind: ProjectStorageKind = ProjectStorageKind.Database,
  toolsetVersion: number = AgentHarnessToolsetProfileVersion.V2,
): AgentHarnessIdentityInput {
  return {
    locale,
    storageKind,
    systemPrompt: systemPromptForLocale(locale, storageKind),
    repositoryCapability: repositoryCapabilityPromptForStorageKind(storageKind),
    tools: toolsForStorageKind(storageKind, toolsetVersion),
    request: agentModelRequestConfig,
  };
}

function expectRegistryError(
  operation: () => unknown,
  code: AgentHarnessRegistryErrorCode,
): AgentHarnessRegistryError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentHarnessRegistryError);
    expect(error).toMatchObject({ code });
    return error as AgentHarnessRegistryError;
  }
  throw new Error(`Expected AgentHarnessRegistryError with code ${code}`);
}

describe("versioned agent harness registry", () => {
  it.each(activeRenderingCases)(
    "resolves the real $locale × $storageKind output with fixed digests",
    ({
      locale,
      storageKind,
      systemPromptDigest,
      toolsetDigest,
      repositoryCapabilityDigest,
      staticPrefixDigest,
    }) => {
      const first = agentHarnessFor(locale, storageKind);
      const second = agentHarnessFor(locale, storageKind);

      expect(second.identity).toEqual(first.identity);
      expect(first).toMatchObject({
        model: first.identity.model.request.model,
        stream: first.identity.model.request.stream,
        toolChoice: first.identity.model.request.toolChoice,
        thinking: first.identity.model.request.thinking,
      });
      expect(first.identity).toMatchObject({
        locale,
        storageKind,
        selection: ActiveAgentHarnessProfileSelection,
        systemPrompt: { renderedDigest: systemPromptDigest },
        toolset: { schemaDigest: toolsetDigest },
        model: {
          request: {
            provider: AgentHarnessProvider.DeepSeek,
            baseURL: "https://api.deepseek.com",
            model: "deepseek-v4-pro",
            stream: true,
            toolChoice: AgentHarnessToolChoice.Auto,
            thinking: { type: AgentHarnessThinkingType.Disabled },
            extraGenerationParameters: {},
          },
          configDigest: modelConfigDigest,
        },
        repositoryCapability: {
          renderedDigest: repositoryCapabilityDigest,
        },
        staticPrefixDigest,
      });
    },
  );

  it("freezes active Database 15-tool and BrowserGit 21-tool provider order exactly", () => {
    const database = agentHarnessFor("zh", ProjectStorageKind.Database);
    const browserGit = agentHarnessFor("zh", ProjectStorageKind.BrowserGit);

    expect(database.identity.toolset.toolOrder).toEqual(activeDatabaseToolOrder);
    expect(database.tools.map((tool) => tool.function.name)).toEqual(activeDatabaseToolOrder);
    expect(browserGit.identity.toolset.toolOrder).toEqual(activeBrowserGitToolOrder);
    expect(browserGit.tools.map((tool) => tool.function.name)).toEqual(activeBrowserGitToolOrder);
  });

  it.each(legacyV1RenderingCases)(
    "reconstructs and restores the frozen v1 $locale × $storageKind toolset",
    ({
      locale,
      storageKind,
      systemPromptDigest,
      toolsetDigest,
      repositoryCapabilityDigest,
      staticPrefixDigest,
    }) => {
      const harness = agentHarnessFor(locale, storageKind, legacyV1Selection);
      const expectedOrder = storageKind === ProjectStorageKind.Database
        ? v1BaseToolOrder
        : v1BrowserGitToolOrder;

      expect(harness.identity).toMatchObject({
        selection: legacyV1Selection,
        systemPrompt: { renderedDigest: systemPromptDigest },
        toolset: {
          profileVersion: AgentHarnessToolsetProfileVersion.V1,
          toolOrder: expectedOrder,
          schemaDigest: toolsetDigest,
        },
        repositoryCapability: {
          renderedDigest: repositoryCapabilityDigest,
        },
        staticPrefixDigest,
      });
      expect(harness.tools.map((tool) => tool.function.name)).toEqual(expectedOrder);
      expect(restoreAgentHarness(harness.identity).identity).toEqual(harness.identity);
    },
  );

  it("stores all four expected rendering digests on every versioned profile", () => {
    const keys: AgentHarnessRenderingKey[] = [
      AgentHarnessRenderingKey.ZhDatabase,
      AgentHarnessRenderingKey.ZhBrowserGit,
      AgentHarnessRenderingKey.EnDatabase,
      AgentHarnessRenderingKey.EnBrowserGit,
    ];

    expect(AgentHarnessProfileRegistry.map((profile) => profile.kind)).toEqual([
      AgentHarnessProfileKind.SystemPrompt,
      AgentHarnessProfileKind.Toolset,
      AgentHarnessProfileKind.Toolset,
      AgentHarnessProfileKind.Model,
      AgentHarnessProfileKind.RepositoryCapability,
    ]);
    for (const profile of AgentHarnessProfileRegistry) {
      expect(Object.keys(profile.expectedDigestByRendering)).toEqual(keys);
      expect(Object.values(profile.expectedDigestByRendering)).toHaveLength(4);
      expect(
        Object.values(profile.expectedDigestByRendering)
          .every((digest) => /^[a-f0-9]{64}$/.test(digest)),
      ).toBe(true);
    }
  });

  it("resolves only the explicitly active exact profile versions", () => {
    const identity = resolveAgentHarnessIdentity(identityInput());

    expect(identity.selection).toEqual(ActiveAgentHarnessProfileSelection);
    expect(identity.systemPrompt).toMatchObject({
      profileId: AgentHarnessProfileId.SystemPrompt,
      profileVersion: 1,
    });
    expect(identity.toolset).toMatchObject({
      profileId: AgentHarnessProfileId.Toolset,
      profileVersion: AgentHarnessToolsetProfileVersion.V2,
    });
    expect(identity.model).toMatchObject({
      profileId: AgentHarnessProfileId.Model,
      profileVersion: 1,
    });
    expect(identity.repositoryCapability).toMatchObject({
      profileId: AgentHarnessProfileId.RepositoryCapability,
      profileVersion: 1,
    });
  });

  it("rejects an unknown profile id without falling back", () => {
    const selection = {
      ...ActiveAgentHarnessProfileSelection,
      systemPrompt: {
        id: "web-cursor.agent.missing-system-prompt",
        version: 1,
      },
    } as unknown as AgentHarnessProfileSelection;

    const error = expectRegistryError(
      () => resolveAgentHarnessIdentity(identityInput(), { selection }),
      AgentHarnessRegistryErrorCode.UnknownProfileId,
    );
    expect(error.context.ref).toEqual(selection.systemPrompt);
  });

  it("rejects an unknown profile version without resolving latest", () => {
    const selection = {
      ...ActiveAgentHarnessProfileSelection,
      systemPrompt: {
        id: AgentHarnessProfileId.SystemPrompt,
        version: 999,
      },
    } satisfies AgentHarnessProfileSelection;

    const error = expectRegistryError(
      () => resolveAgentHarnessIdentity(identityInput(), { selection }),
      AgentHarnessRegistryErrorCode.UnknownProfileVersion,
    );
    expect(error.context.ref).toEqual(selection.systemPrompt);
  });

  it("fails closed when harness assembly receives an unknown toolset version", () => {
    const selection = {
      ...ActiveAgentHarnessProfileSelection,
      toolset: {
        id: AgentHarnessProfileId.Toolset,
        version: 999,
      },
    } satisfies AgentHarnessProfileSelection;

    expect(() => agentHarnessFor(
      "zh",
      ProjectStorageKind.Database,
      selection,
    )).toThrow("Unknown agent toolset version: 999");
  });

  it("fails closed when a registered expected digest drifts", () => {
    const renderingKey = AgentHarnessRenderingKey.ZhDatabase;
    const registry = AgentHarnessProfileRegistry.map((profile) => {
      if (profile.kind !== AgentHarnessProfileKind.SystemPrompt) return profile;
      return {
        ...profile,
        expectedDigestByRendering: {
          ...profile.expectedDigestByRendering,
          [renderingKey]:
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      };
    }) satisfies AgentHarnessProfileRegistryValue;

    const error = expectRegistryError(
      () => resolveAgentHarnessIdentity(identityInput(), { registry }),
      AgentHarnessRegistryErrorCode.DigestMismatch,
    );
    expect(error.context).toMatchObject({
      kind: AgentHarnessProfileKind.SystemPrompt,
      renderingKey,
      expectedDigest:
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      actualDigest:
        "f317dc9cfdc9fca24f1dcd5b595acee34557f7533b91f533157ab38acf0510c7",
    });
  });

  it("rejects unknown request fields instead of omitting them from identity", () => {
    const input = identityInput();
    const requestWithUnknownField = {
      ...input.request,
      temperature: 0,
    } as unknown as AgentHarnessIdentityInput["request"];

    expect(() => resolveAgentHarnessIdentity({
      ...input,
      request: requestWithUnknownField,
    })).toThrow(/request must contain exactly/);
  });
});

describe("canonical agent harness JSON", () => {
  it("sorts object keys but preserves array order", () => {
    expect(canonicalJson({
      schema: {
        required: ["path", "revision"],
        properties: {
          revision: { minimum: 0, type: "integer" },
          path: { minLength: 1, type: "string" },
        },
      },
    })).toBe(canonicalJson({
      schema: {
        properties: {
          path: { type: "string", minLength: 1 },
          revision: { type: "integer", minimum: 0 },
        },
        required: ["path", "revision"],
      },
    }));

    expect(canonicalJson(["list_files", "read_file"]))
      .not.toBe(canonicalJson(["read_file", "list_files"]));
  });

  it.each([
    ["undefined", { schema: undefined }, /undefined is not a JSON value/],
    ["non-finite number", { maximum: Number.POSITIVE_INFINITY }, /numbers must be finite/],
    ["Date instance", { createdAt: new Date(0) }, /only plain objects and arrays/],
    ["sparse array", new Array(1), /sparse array slots/],
  ])("rejects %s instead of guessing a JSON representation", (_label, value, message) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });
});
