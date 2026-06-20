/** agent 运行过程在 UI 上的状态模型，组件与 useChat 共享。 */

export type Phase =
  | "writing"
  | "transpiling"
  | "running"
  | "ok"
  | "compile-fail"
  | "runtime-fail";

export interface Attempt {
  n: number;
  phase: Phase;
  note?: string;
}

export type Message =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "ai";
      attempts: Attempt[];
      summary?: string;
      summaryKind?: "ok" | "fail";
      diff?: string;
      chatText?: string; // AI 直接回话/提问（reply），非写代码时显示
    };

export interface Status {
  kind: "" | "load" | "ok" | "err";
  text: string;
  meta?: string;
}

export interface Overlay {
  show: boolean;
  message: string;
  stack: string;
  showStack: boolean;
}

export const PHASE_LABEL: Record<Phase, string> = {
  writing: "✍️ 写代码…",
  transpiling: "🔧 转译中…",
  running: "▶️ 执行中…",
  ok: "✓ 渲染成功",
  "compile-fail": "✕ 编译报错",
  "runtime-fail": "✕ 运行报错",
};
