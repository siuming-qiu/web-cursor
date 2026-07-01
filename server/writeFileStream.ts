/**
 * [INPUT]: 累积中的 write_file tool arguments JSON 字符串
 * [OUTPUT]: 可用于 UI 展示的 path 与 content 增量；不参与真实文件写入
 * [POS]: A 域 SSE 辅助解析器 —— 只解析 write_file 参数流里的展示字段
 * [PROTOCOL]: 只读 path/content 字符串；落盘仍以完整 JSON.parse + WriteFileArgsSchema 为准。
 */
import "server-only";

export type WriteFileStreamState = {
  path?: string;
  contentLength: number;
};

export type WriteFileStreamUpdate = {
  path?: string;
  delta?: string;
  state: WriteFileStreamState;
};

type StringReadResult = {
  value: string;
  complete: boolean;
  end: number;
};

function isWhitespace(char: string) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function skipWhitespace(input: string, index: number) {
  let i = index;
  while (i < input.length && isWhitespace(input[i])) i += 1;
  return i;
}

function readJsonString(input: string, quoteIndex: number, allowPartial: boolean): StringReadResult | null {
  if (input[quoteIndex] !== "\"") return null;

  let value = "";
  let i = quoteIndex + 1;
  while (i < input.length) {
    const char = input[i];

    if (char === "\"") {
      return { value, complete: true, end: i + 1 };
    }

    if (char !== "\\") {
      value += char;
      i += 1;
      continue;
    }

    const escaped = input[i + 1];
    if (!escaped) break;

    if (escaped === "u") {
      const hex = input.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }

    const decoded: Record<string, string> = {
      "\"": "\"",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (!(escaped in decoded)) break;
    value += decoded[escaped];
    i += 2;
  }

  if (!allowPartial) return null;
  return { value, complete: false, end: input.length };
}

function readStringField(input: string, fieldName: "path" | "content", allowPartialValue: boolean): StringReadResult | null {
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "\"") {
      i += 1;
      continue;
    }

    const key = readJsonString(input, i, false);
    if (!key) return null;

    let cursor = skipWhitespace(input, key.end);
    if (input[cursor] !== ":") {
      i = key.end;
      continue;
    }

    cursor = skipWhitespace(input, cursor + 1);
    if (key.value === fieldName) {
      return readJsonString(input, cursor, allowPartialValue);
    }

    i = key.end;
  }

  return null;
}

export function extractWriteFileStreamUpdate(
  argumentsJson: string,
  previous: WriteFileStreamState = { contentLength: 0 },
): WriteFileStreamUpdate | null {
  const pathResult = readStringField(argumentsJson, "path", false);
  const nextPath = pathResult?.complete ? pathResult.value : previous.path;

  const contentResult = readStringField(argumentsJson, "content", true);
  const content = contentResult?.value ?? "";
  const previousLength = Math.min(previous.contentLength, content.length);
  const delta = content.slice(previousLength);

  const state = {
    path: nextPath,
    contentLength: content.length,
  };

  const pathChanged = nextPath && nextPath !== previous.path;
  if (!pathChanged && !delta) return { state };

  return {
    path: pathChanged ? nextPath : undefined,
    delta: delta || undefined,
    state,
  };
}
