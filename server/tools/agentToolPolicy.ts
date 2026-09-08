/**
 * [INPUT]: exact tool name + project storage kind
 * [OUTPUT]: persisted AgentRun execution-domain/effect classification
 * [POS]: A 域工具策略契约 —— ledger 与执行器共享同一份副作用分类
 * [PROTOCOL]: known tools must be exhaustively classified; unknown model names fail closed before ledger persistence
 */
import "server-only";
import {
  AgentToolEffect,
  AgentToolExecutionDomain,
  type AgentToolEffect as AgentToolEffectValue,
  type AgentToolExecutionDomain as AgentToolExecutionDomainValue,
} from "@/types/agentRun";
import { clientToolRunsInBrowser } from "@/types/clientTool";
import { ProjectStorageKind, type ProjectStorageKind as ProjectStorageKindValue } from "@/types/projectStorage";
import { ToolName, type ToolName as ToolNameValue } from "@/types/tool";

const MUTATION_TOOLS = new Set<string>([
  ToolName.WriteFile,
  ToolName.DeleteFile,
  ToolName.RenameFile,
  ToolName.GitStage,
  ToolName.GitUnstage,
  ToolName.GitCommit,
  ToolName.GenerateImage,
  ToolName.SpawnAgent,
  ToolName.SendMessage,
  ToolName.FollowupTask,
  ToolName.InterruptAgent,
]);

const SUBAGENT_CONTROL_TOOLS = new Set<string>([
  ToolName.SpawnAgent,
  ToolName.WaitAgent,
  ToolName.SendMessage,
  ToolName.FollowupTask,
  ToolName.InterruptAgent,
]);

function isKnownTool(name: string): name is ToolNameValue {
  return Object.values(ToolName).includes(name as ToolNameValue);
}

export class AgentToolPolicyError extends Error {
  constructor(readonly toolName: string) {
    super(`Unknown tool cannot be classified: ${toolName}`);
    this.name = "AgentToolPolicyError";
  }
}

function requireKnownTool(toolName: string): ToolNameValue {
  if (isKnownTool(toolName)) return toolName;
  throw new AgentToolPolicyError(toolName);
}

export function agentToolExecutionDomain(
  toolName: string,
  storageKind: ProjectStorageKindValue,
): AgentToolExecutionDomainValue {
  const knownTool = requireKnownTool(toolName);
  if (SUBAGENT_CONTROL_TOOLS.has(knownTool)) {
    return AgentToolExecutionDomain.Server;
  }
  if (clientToolRunsInBrowser(knownTool, storageKind)) {
    return AgentToolExecutionDomain.Client;
  }
  if (knownTool === ToolName.GenerateImage) {
    return AgentToolExecutionDomain.Async;
  }
  return AgentToolExecutionDomain.Server;
}

export function agentToolEffect(toolName: string): AgentToolEffectValue {
  const knownTool = requireKnownTool(toolName);
  if (knownTool === ToolName.WaitAgent) return AgentToolEffect.Read;
  return MUTATION_TOOLS.has(knownTool)
    ? AgentToolEffect.Mutation
    : AgentToolEffect.Read;
}

export function serverToolRequiresRunTransaction(
  toolName: string,
  storageKind: ProjectStorageKindValue,
): boolean {
  const knownTool = requireKnownTool(toolName);
  if (
    SUBAGENT_CONTROL_TOOLS.has(knownTool)
    && knownTool !== ToolName.WaitAgent
  ) {
    return true;
  }
  if (storageKind !== ProjectStorageKind.Database) return false;
  return knownTool === ToolName.WriteFile
    || knownTool === ToolName.DeleteFile
    || knownTool === ToolName.RenameFile;
}
