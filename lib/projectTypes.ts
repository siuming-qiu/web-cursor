import type { ImageRunView } from "@/lib/types";

export type Project = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
};

export type Conversation = {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
};

export type ProjectFileSummary = {
  path: string;
  updatedAt: string;
};

export type ProjectFileContent = ProjectFileSummary & {
  content: string;
};

export type ProjectDetail = Project & {
  conversations: Conversation[];
  files: ProjectFileSummary[];
};

export const FileContentAction = {
  Write: "write",
  Delete: "delete",
} as const;

export type FileContentAction = typeof FileContentAction[keyof typeof FileContentAction];

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: unknown;
  imageRuns?: ImageRunView[];
};

export function formatTime(value?: string, locale = "zh") {
  if (!value) return locale === "en" ? "Unknown time" : "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "en" ? "Unknown time" : "未知时间";
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function normalizeCreatedProject(value: Project | Project[]): Project {
  return Array.isArray(value) ? value[0] : value;
}
