/**
 * [INPUT]: 父窗口 postMessage {type:'RUN', code}（转译后的 JS）
 * [OUTPUT]: 向父窗口 postMessage RENDER_OK / RUNTIME_ERROR / CONSOLE / SANDBOX_READY
 * [POS]: C 域沙箱内容 —— 执行不可信 AI 代码 + 把结果回传，是自我修复闭环的接缝
 * [PROTOCOL]: 这是 iframe 的 srcdoc，纯静态脚本（无 AI 代码内联）；改回传协议要同步 controller.ts
 *
 * 隔离：iframe 用 sandbox="allow-scripts"（无 allow-same-origin → opaque origin），
 * AI 代码跑在 null origin 里，碰不到父站 cookie/DOM。依赖走 esm.sh（CORS *）。
 * 上线需进一步独立 origin 部署（见 CLAUDE.md），本地 MVP 先用 sandbox 属性。
 */

const REACT = "https://esm.sh/react@18.3.1";
const REACT_DOM_CLIENT = "https://esm.sh/react-dom@18.3.1/client";
const JSX_RUNTIME = "https://esm.sh/react@18.3.1/jsx-runtime";

export const RUNNER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script type="importmap">
{"imports":{
  "react":"${REACT}",
  "react-dom/client":"${REACT_DOM_CLIENT}",
  "react/jsx-runtime":"${JSX_RUNTIME}"
}}
</script>
<style>
  html,body{margin:0}
  body{font-family:-apple-system,"PingFang SC",sans-serif;padding:0}
  #root{padding:0}
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
import React from "react";
import { createRoot } from "react-dom/client";

const post = (m) => parent.postMessage(m, "*");

// 当前这一轮是否已报错（防止报错后又误发 RENDER_OK）
let runFailed = false;
function fail(message, stack) {
  runFailed = true;
  post({ type: "RUNTIME_ERROR", message: String(message || "未知错误"), stack: String(stack || "") });
}

// console 转发
["log", "warn", "error"].forEach((k) => {
  const orig = console[k];
  console[k] = (...args) => {
    try {
      post({ type: "CONSOLE", level: k, text: args.map((a) => {
        try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); }
      }).join(" ") });
    } catch {}
    orig.apply(console, args);
  };
});

window.addEventListener("error", (e) => fail(e.message, e.error && e.error.stack));
window.addEventListener("unhandledrejection", (e) =>
  fail("Unhandled rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason),
       e.reason && e.reason.stack));

// 错误边界：捕获 React 渲染期错误（如 list.mp is not a function）
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { fail(err && err.message, err && err.stack); }
  render() {
    if (this.state.err) {
      return React.createElement("div",
        { style: { color: "#b00", fontFamily: "monospace", padding: 16, whiteSpace: "pre-wrap" } },
        String(this.state.err && this.state.err.message || this.state.err));
    }
    return this.props.children;
  }
}

let root = null;

window.addEventListener("message", async (e) => {
  const d = e.data;
  if (!d || d.type !== "RUN") return;
  runFailed = false;
  try {
    const blob = new Blob([d.code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    let mod;
    try { mod = await import(url); } finally { URL.revokeObjectURL(url); }

    const App = mod.default;
    if (typeof App !== "function") {
      fail("模块没有 export default 一个 React 组件");
      return;
    }
    if (!root) root = createRoot(document.getElementById("root"));
    // ErrorBoundary 重新挂载：key 变化强制重建，确保上一轮错误状态不残留
    root.render(React.createElement(ErrorBoundary, { key: Math.random() }, React.createElement(App)));

    // 渲染后两帧无错 → 判定 RENDER_OK
    requestAnimationFrame(() =>
      requestAnimationFrame(() => { if (!runFailed) post({ type: "RENDER_OK" }); }));
  } catch (err) {
    fail(err && err.message ? err.message : err, err && err.stack);
  }
});

post({ type: "SANDBOX_READY" });
</script>
</body>
</html>`;
