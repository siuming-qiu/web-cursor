import type { ProjectFileSummary } from "@/lib/projectTypes";

export const APP_ENTRY_PATH = "src/App.tsx";

export const REQUIRED_RSBUILD_PROJECT_FILES = [
  "package.json",
  "rsbuild.config.ts",
  "index.html",
  "src/main.tsx",
  APP_ENTRY_PATH,
] as const;

export function hasCompleteReactProject(files: Pick<ProjectFileSummary, "path">[]) {
  const paths = new Set(files.map((file) => file.path));
  return REQUIRED_RSBUILD_PROJECT_FILES.every((path) => paths.has(path));
}
