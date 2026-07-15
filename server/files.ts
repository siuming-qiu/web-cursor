/**
 * [INPUT]: projectId + project-local file path/content，或受限的单行字面量 search query
 * [OUTPUT]: project file summaries/content，或带 1-based 行列的受限文本搜索结果
 * [POS]: A 域项目文件业务层 —— project_files 的唯一读写入口
 * [PROTOCOL]: 文件 path/search query 只在这里做业务规则校验；Route Handler 和 Tool Executor 不直接写 SQL
 */
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { projectFiles, projects } from "@/server/db/schema";
import { containsUnicodeLineTerminator, countUnicodeCodePoints, SearchTextLimits } from "@/types/tool";

export type ProjectFileSummary = {
  path: string;
  updatedAt: string;
};

export type ProjectFileContent = ProjectFileSummary & {
  content: string;
};

export type ProjectTextSearchMatch = {
  path: string;
  line: number;
  column: number;
  snippet: string;
};

export type ProjectTextSearchResult = {
  matches: ProjectTextSearchMatch[];
  truncated: boolean;
};

export const FileOperationErrorCode = {
  BadPath: "BAD_PATH",
  BadSearchQuery: "BAD_SEARCH_QUERY",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  InternalError: "INTERNAL_ERROR",
} as const;

export type FileOperationErrorCode =
  typeof FileOperationErrorCode[keyof typeof FileOperationErrorCode];

export class FileOperationError extends Error {
  code: FileOperationErrorCode;

  constructor(code: FileOperationErrorCode, message: string) {
    super(message);
    this.name = "FileOperationError";
    this.code = code;
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: { path: string; updatedAt: Date | string }): ProjectFileSummary {
  return { path: row.path, updatedAt: toIso(row.updatedAt) };
}

function toContent(row: { path: string; content: string; updatedAt: Date | string }): ProjectFileContent {
  return { ...toSummary(row), content: row.content };
}

export function validateProjectFilePath(path: string): void {
  if (!path.trim()) throw new FileOperationError(FileOperationErrorCode.BadPath, "File path is required.");
  if (path.startsWith("/")) {
    throw new FileOperationError(FileOperationErrorCode.BadPath, "File path must not start with '/'.");
  }
  if (path.endsWith("/")) {
    throw new FileOperationError(FileOperationErrorCode.BadPath, "File path must not end with '/'.");
  }
  if (path.includes("//")) {
    throw new FileOperationError(FileOperationErrorCode.BadPath, "File path must not contain '//'.");
  }

  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new FileOperationError(FileOperationErrorCode.BadPath, "File path contains invalid segment.");
  }
}

function validateProjectTextSearchQuery(query: string): void {
  const invalid = query.length === 0
    || countUnicodeCodePoints(query) > SearchTextLimits.QueryCodePoints
    || query.trim().length === 0
    || containsUnicodeLineTerminator(query)
    || query.includes("\0");

  if (invalid) {
    throw new FileOperationError(
      FileOperationErrorCode.BadSearchQuery,
      "Search query must be non-empty, single-line text within the configured limit.",
    );
  }
}

async function touchProject(projectId: string): Promise<void> {
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export async function listProjectFiles(projectId: string): Promise<ProjectFileSummary[]> {
  const rows = await db
    .select({ path: projectFiles.path, updatedAt: projectFiles.updatedAt })
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)))
    .orderBy(asc(projectFiles.path));

  return rows.map(toSummary);
}

export async function listProjectFileContents(projectId: string): Promise<ProjectFileContent[]> {
  const rows = await db
    .select({
      path: projectFiles.path,
      content: projectFiles.content,
      updatedAt: projectFiles.updatedAt,
    })
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)))
    .orderBy(asc(projectFiles.path));

  return rows.map(toContent);
}

function textSearchSnippet(line: string, matchIndex: number, query: string): string {
  const width = SearchTextLimits.SnippetCodePoints;
  const lineCodePoints = Array.from(line);
  if (lineCodePoints.length <= width) return line;

  const matchCodePointIndex = countUnicodeCodePoints(line.slice(0, matchIndex));
  const queryCodePoints = countUnicodeCodePoints(query);
  const contextBefore = Math.floor((width - queryCodePoints) / 2);
  const start = Math.max(0, Math.min(matchCodePointIndex - contextBefore, lineCodePoints.length - width));
  const end = start + width;
  return `${start > 0 ? "…" : ""}${lineCodePoints.slice(start, end).join("")}${end < lineCodePoints.length ? "…" : ""}`;
}

function collectTextSearchMatches(
  rows: { path: string; content: string }[],
  query: string,
): ProjectTextSearchResult {
  const matches: ProjectTextSearchMatch[] = [];

  for (const row of rows) {
    const lines = row.content.split(/\r\n|[\n\r\u2028\u2029]/u);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let from = 0;

      while (from < line.length) {
        const matchIndex = line.indexOf(query, from);
        if (matchIndex === -1) break;

        matches.push({
          path: row.path,
          line: lineIndex + 1,
          column: matchIndex + 1,
          snippet: textSearchSnippet(line, matchIndex, query),
        });
        if (matches.length > SearchTextLimits.Matches) {
          return { matches: matches.slice(0, SearchTextLimits.Matches), truncated: true };
        }
        from = matchIndex + query.length;
      }
    }
  }

  return { matches, truncated: false };
}

export async function searchProjectFiles(projectId: string, query: string): Promise<ProjectTextSearchResult> {
  validateProjectTextSearchQuery(query);

  const rows = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(and(
      eq(projectFiles.projectId, projectId),
      isNull(projectFiles.deletedAt),
      sql`strpos(${projectFiles.content}, ${query}) > 0`,
    ))
    .orderBy(asc(projectFiles.path))
    .limit(SearchTextLimits.Matches + 1);

  return collectTextSearchMatches(rows, query);
}

export async function readProjectFile(projectId: string, path: string): Promise<ProjectFileContent> {
  validateProjectFilePath(path);

  const [row] = await db
    .select({
      path: projectFiles.path,
      content: projectFiles.content,
      updatedAt: projectFiles.updatedAt,
    })
    .from(projectFiles)
    .where(and(
      eq(projectFiles.projectId, projectId),
      eq(projectFiles.path, path),
      isNull(projectFiles.deletedAt),
    ))
    .limit(1);

  if (!row) throw new FileOperationError(FileOperationErrorCode.NotFound, `File not found: ${path}`);
  return toContent(row);
}

export async function writeProjectFile(
  projectId: string,
  path: string,
  content: string,
): Promise<ProjectFileContent> {
  validateProjectFilePath(path);
  const now = new Date();

  const [existing] = await db
    .select({ id: projectFiles.id })
    .from(projectFiles)
    .where(and(
      eq(projectFiles.projectId, projectId),
      eq(projectFiles.path, path),
      isNull(projectFiles.deletedAt),
    ))
    .limit(1);

  const [row] = existing
    ? await db
        .update(projectFiles)
        .set({ content, updatedAt: now })
        .where(eq(projectFiles.id, existing.id))
        .returning({
          path: projectFiles.path,
          content: projectFiles.content,
          updatedAt: projectFiles.updatedAt,
        })
    : await db
        .insert(projectFiles)
        .values({ projectId, path, content, updatedAt: now })
        .returning({
          path: projectFiles.path,
          content: projectFiles.content,
          updatedAt: projectFiles.updatedAt,
        });

  await touchProject(projectId);
  return toContent(row);
}

export async function deleteProjectFile(projectId: string, path: string): Promise<void> {
  validateProjectFilePath(path);

  const [row] = await db
    .update(projectFiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(projectFiles.projectId, projectId),
      eq(projectFiles.path, path),
      isNull(projectFiles.deletedAt),
    ))
    .returning({ id: projectFiles.id });

  if (!row) throw new FileOperationError(FileOperationErrorCode.NotFound, `File not found: ${path}`);
  await touchProject(projectId);
}

export async function renameProjectFile(
  projectId: string,
  oldPath: string,
  newPath: string,
): Promise<ProjectFileSummary> {
  validateProjectFilePath(oldPath);
  validateProjectFilePath(newPath);
  if (oldPath === newPath) return readProjectFile(projectId, oldPath);

  const [target] = await db
    .select({ id: projectFiles.id })
    .from(projectFiles)
    .where(and(
      eq(projectFiles.projectId, projectId),
      eq(projectFiles.path, newPath),
      isNull(projectFiles.deletedAt),
    ))
    .limit(1);

  if (target) throw new FileOperationError(FileOperationErrorCode.Conflict, `File already exists: ${newPath}`);

  const [row] = await db
    .update(projectFiles)
    .set({ path: newPath, updatedAt: new Date() })
    .where(and(
      eq(projectFiles.projectId, projectId),
      eq(projectFiles.path, oldPath),
      isNull(projectFiles.deletedAt),
    ))
    .returning({ path: projectFiles.path, updatedAt: projectFiles.updatedAt });

  if (!row) throw new FileOperationError(FileOperationErrorCode.NotFound, `File not found: ${oldPath}`);
  await touchProject(projectId);
  return toSummary(row);
}
