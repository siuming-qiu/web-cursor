/**
 * [INPUT]: 用户 prompt（send 调用）+ PreviewPanel 挂上来的 iframe ref
 * [OUTPUT]: 会话 UI 状态 + send/stop/rerun；供 page 编排、组件展示
 * [POS]: B 域编排 hook —— 串起 后端 /api/chat（chatClient）→ 转译 → 沙箱 → 自我修复
 * [PROTOCOL]: 后端协议见 lib/chatClient.ts（{type:code|chat|done|error}）；转译/沙箱是真的
 *
 * 流程：send(prompt) → 流式拿后端结果
 *   - type:"code" → 灌编辑器；流完 → 转译 + 跑沙箱；出错 → 带"报错+当前代码"回喂后端（自我修复，单条 message 自包含）
 *   - type:"chat" → AI 在提问/回话 → 显示文字，停下等用户
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SandboxController } from "@/lib/sandbox/controller";
import { transpile, TranspileError } from "@/lib/transpile";
import { streamChat } from "@/lib/chatClient";
import type { Message, Phase, Status, Overlay } from "@/lib/types";

const MAX_ATTEMPTS = 4;
const EMPTY_OVERLAY: Overlay = { show: false, message: "", stack: "", showStack: false };

function titleFromPrompt(p: string): string {
  return p.length > 16 ? p.slice(0, 16) + "…" : p;
}

export function useChat() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxRef = useRef<SandboxController | null>(null);
  const abortRef = useRef({ aborted: false });
  const curAiIdRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [code, setCode] = useState("");
  const [writing, setWriting] = useState(false);
  const [projName, setProjName] = useState("未命名项目");
  const [status, setStatus] = useState<Status>({ kind: "", text: "等待生成" });
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [busy, setBusy] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);

  useEffect(() => {
    if (iframeRef.current && !sandboxRef.current) {
      const ctl = new SandboxController(iframeRef.current);
      ctl.onLateError = (e) =>
        setOverlay({ show: true, message: e.message, stack: e.stack, showStack: false });
      sandboxRef.current = ctl;
    }
    return () => sandboxRef.current?.dispose();
  }, []);

  const updateAi = useCallback(
    (fn: (m: Extract<Message, { role: "ai" }>) => Extract<Message, { role: "ai" }>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === curAiIdRef.current && m.role === "ai" ? fn(m) : m))
      );
    },
    []
  );

  const setAttempt = useCallback(
    (n: number, phase: Phase, note?: string) => {
      updateAi((m) => {
        const attempts = [...m.attempts];
        const idx = attempts.findIndex((a) => a.n === n);
        const next = { n, phase, note };
        if (idx >= 0) attempts[idx] = next;
        else attempts.push(next);
        return { ...m, attempts };
      });
    },
    [updateAi]
  );

  // 一轮 agent loop：流式取结果 → 转译 → 沙箱 → 出错回喂（自我修复）
  const runLoop = useCallback(
    async (firstMessage: string) => {
      let message = firstMessage;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (abortRef.current.aborted) return;
        setAttempt(attempt, "writing");
        setWriting(true);
        setStatus({ kind: "load", text: "AI 正在写代码…" });

        // 1) 流式取后端结果
        let codeText = "";
        let gotCode = false;
        try {
          for await (const ev of streamChat(message)) {
            if (abortRef.current.aborted) return;
            if (ev.type === "code") {
              gotCode = true;
              codeText = ev.code;
              setCode(codeText);
            } else if (ev.type === "chat") {
              updateAi((m) => ({ ...m, chatText: ev.message }));
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
            // "done" 忽略，以流关闭为准
          }
        } catch (e: any) {
          setWriting(false);
          setStatus({ kind: "err", text: "请求失败", meta: "" });
          setOverlay({ show: true, message: String(e?.message ?? e), stack: "", showStack: false });
          updateAi((m) => ({ ...m, summaryKind: "fail", summary: "调用后端失败" }));
          setBusy(false);
          return;
        }
        setWriting(false);

        // 2) AI 没写代码（在提问/回话）→ 停下等用户
        if (!gotCode) {
          setStatus({ kind: "", text: "等待你的回复" });
          setBusy(false);
          return;
        }

        // 3) 转译
        setStatus({ kind: "load", text: "转译中…（esbuild-wasm）" });
        setAttempt(attempt, "transpiling");
        let js: string;
        try {
          js = await transpile(codeText);
        } catch (e) {
          const failures =
            e instanceof TranspileError ? e.failures : [{ text: String(e), location: null }];
          const txt = failures.map((f) => f.text).join("; ");
          setAttempt(attempt, "compile-fail", txt);
          setStatus({ kind: "err", text: "编译报错", meta: `· 第${attempt}次` });
          setOverlay({ show: true, message: "编译错误：" + txt, stack: "", showStack: false });
          setPreviewActive(true);
          if (attempt === MAX_ATTEMPTS) return finishFail();
          message = `代码编译失败：${txt}\n\n当前代码：\n${codeText}\n\n请修复后输出完整代码。`;
          continue;
        }

        // 4) 跑沙箱
        setStatus({ kind: "load", text: "执行中…" });
        setAttempt(attempt, "running");
        setPreviewActive(true);
        const t0 = performance.now();
        const result = await sandboxRef.current!.run(js);
        const dur = Math.round(performance.now() - t0);
        if (abortRef.current.aborted) return;

        // 5) 读结果
        if (result.type === "RENDER_OK") {
          setAttempt(attempt, "ok");
          setStatus({ kind: "ok", text: "渲染成功", meta: `· 第${attempt}次 · ${dur}ms` });
          setOverlay((o) => ({ ...o, show: false }));
          setHasResult(true);
          updateAi((m) => ({
            ...m,
            summaryKind: "ok",
            summary: attempt > 1 ? `已修复 ✓ 第 ${attempt} 次渲染成功` : "已生成 ✓ 渲染成功",
            diff: attempt > 1 ? "AI 读取报错后自动修正" : undefined,
          }));
          setBusy(false);
          return;
        }

        setAttempt(attempt, "runtime-fail", result.message);
        setStatus({ kind: "err", text: "运行报错", meta: `· 第${attempt}次` });
        setOverlay({ show: true, message: result.message, stack: result.stack, showStack: false });
        if (attempt === MAX_ATTEMPTS) return finishFail();
        message = `运行报错，请修复后输出完整代码：\n${result.message}\n${result.stack}\n\n当前代码：\n${codeText}`;
      }

      function finishFail() {
        updateAi((m) => ({ ...m, summaryKind: "fail", summary: "尝试多次仍未修复 ✕，可重试或手动接管" }));
        setStatus({ kind: "err", text: "未能修复", meta: "" });
        setBusy(false);
      }
    },
    [setAttempt, updateAi]
  );

  const send = useCallback(
    (prompt: string) => {
      if (busy || !prompt.trim() || !sandboxRef.current) return;
      const p = prompt.trim();
      lastPromptRef.current = p;
      setProjName(titleFromPrompt(p));

      const userId = crypto.randomUUID();
      const aiId = crypto.randomUUID();
      curAiIdRef.current = aiId;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", text: p },
        { id: aiId, role: "ai", attempts: [] },
      ]);
      setBusy(true);
      setHasResult(false);
      setOverlay(EMPTY_OVERLAY);
      setCode("");
      abortRef.current = { aborted: false };

      runLoop(p).catch((err) => {
        setBusy(false);
        setStatus({ kind: "err", text: "内部错误", meta: "" });
        setOverlay({ show: true, message: String(err?.message ?? err), stack: String(err?.stack ?? ""), showStack: false });
      });
    },
    [busy, runLoop]
  );

  const stop = useCallback(() => {
    abortRef.current.aborted = true;
    setBusy(false);
    setWriting(false);
    setStatus({ kind: "", text: "已停止" });
  }, []);

  const rerun = useCallback(() => {
    if (lastPromptRef.current) send(lastPromptRef.current);
  }, [send]);

  return {
    iframeRef,
    curAiId: curAiIdRef,
    messages,
    code,
    writing,
    projName,
    status,
    overlay,
    setOverlay,
    busy,
    hasResult,
    previewActive,
    send,
    stop,
    rerun,
  };
}
