/**
 * [INPUT]: 当前编辑器光标上下文 + x-owner-id
 * [OUTPUT]: 可插入到光标位置的 inline completion 文本
 * [POS]: A 域轻量代码补全 Route Handler —— 持 key 调 LLM，不写项目文件
 * [PROTOCOL]: 独立于 chat agent loop；请求/响应都走严格 schema，模型输出不合法时返回空建议。
 */
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { ownsProject } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { listProjectFiles } from "@/server/files";
import llmClient from "@/server/llm";
import { CODE_COMPLETION_MODEL } from "@/server/models";
import {
  CodeCompletionModelResponseSchema,
  CodeCompletionRequestSchema,
  CodeCompletionResponseSchema,
  CodeCompletionTrigger,
  type CodeCompletionRequest,
} from "@/types/codeCompletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeepSeekCompletionParams = ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: "disabled" };
};

const MAX_PROJECT_FILES_IN_PROMPT = 80;

function completionSystemPrompt() {
  return [
    "You are an inline code completion engine for a React TypeScript project.",
    "Return JSON only, with this exact shape: {\"insertText\":\"...\"}.",
    "insertText must be only the text to insert at the cursor.",
    "For automatic trigger, insertText must be at most 12 lines.",
    "For explicit trigger, insertText must be at most 40 lines.",
    "Prefer completing the current expression, JSX node, function body, or small block.",
    "Never return a full file or full component unless the prefix is nearly empty.",
    "Do not repeat code that already exists before the cursor.",
    "Do not explain. Do not use markdown. Do not wrap code fences.",
    "Do not modify other files.",
    "If no useful completion is available, return {\"insertText\":\"\"}.",
    "Project constraints:",
    "- The app is a React + TypeScript + Rsbuild project.",
    "- Do not introduce undeclared third-party imports.",
    "- Prefer continuing the user's current style.",
  ].join("\n");
}

function completionUserPrompt(input: CodeCompletionRequest, files: { path: string }[]) {
  const fileList = files
    .slice(0, MAX_PROJECT_FILES_IN_PROMPT)
    .map((file) => `- ${file.path}`)
    .join("\n");

  return [
    `Current file: ${input.path}`,
    `Language: ${input.language}`,
    `Trigger: ${input.trigger}`,
    "Context: local cursor window only. Code before or after this window may be omitted.",
    "",
    "Project files:",
    fileList || "- <none>",
    "",
    "Before cursor:",
    "<<<PREFIX",
    input.prefix,
    "PREFIX",
    "",
    "After cursor:",
    "<<<SUFFIX",
    input.suffix,
    "SUFFIX",
  ].join("\n");
}

function emptyCompletion(reason: string) {
  return CodeCompletionResponseSchema.parse({ insertText: "", reason });
}

function sanitizeCompletion(insertText: string) {
  const text = insertText.replace(/\r\n/g, "\n");
  if (text.includes("```")) return "";
  return text;
}

function outputLimitForTrigger(trigger: CodeCompletionRequest["trigger"]) {
  return trigger === CodeCompletionTrigger.Explicit
    ? { maxTokens: 512, maxChars: 3000 }
    : { maxTokens: 160, maxChars: 1200 };
}

async function requestCompletion(input: CodeCompletionRequest, files: { path: string }[]) {
  const limit = outputLimitForTrigger(input.trigger);
  const params: DeepSeekCompletionParams = {
    model: CODE_COMPLETION_MODEL,
    messages: [
      { role: "system", content: completionSystemPrompt() },
      { role: "user", content: completionUserPrompt(input, files) },
    ],
    response_format: { type: "json_object" },
    temperature: input.trigger === CodeCompletionTrigger.Explicit ? 0.25 : 0.15,
    max_tokens: limit.maxTokens,
    stream: false,
    thinking: { type: "disabled" },
  };

  return llmClient.chat.completions.create(params);
}

export async function POST(req: Request) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  let body: CodeCompletionRequest;
  try {
    body = CodeCompletionRequestSchema.parse(await req.json());
  } catch (error) {
    return Response.json({ error: "bad request", detail: String(error) }, { status: 400 });
  }

  if (!(await ownsProject(body.projectId, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  try {
    const files = await listProjectFiles(body.projectId);
    const completion = await requestCompletion(body, files);
    const raw = completion.choices[0]?.message.content ?? "";
    const parsedJson = JSON.parse(raw) as unknown;
    const parsed = CodeCompletionModelResponseSchema.safeParse(parsedJson);

    if (!parsed.success) {
      console.warn("Invalid code completion model response", parsed.error.message);
      return Response.json(emptyCompletion("invalid_model_response"));
    }

    const insertText = sanitizeCompletion(parsed.data.insertText);
    if (insertText.length > outputLimitForTrigger(body.trigger).maxChars) {
      console.warn("Code completion model response exceeded trigger limit", {
        trigger: body.trigger,
        length: insertText.length,
      });
      return Response.json(emptyCompletion("completion_too_long"));
    }

    return Response.json(CodeCompletionResponseSchema.parse({ insertText }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn("Malformed code completion model JSON", error.message);
      return Response.json(emptyCompletion("malformed_model_json"));
    }
    console.warn("Code completion failed", error);
    return Response.json(emptyCompletion("completion_failed"));
  }
}
