/**
 * [INPUT]: 父窗口 postMessage {type:'RUN', project:{js,css,importMap}}（项目编译产物）
 * [OUTPUT]: 向父窗口 postMessage RENDER_OK / RUNTIME_ERROR / CONSOLE / SANDBOX_READY
 * [POS]: C 域沙箱内容 —— 执行不可信 AI 代码 + 把结果回传，是自我修复闭环的接缝
 * [PROTOCOL]: 这是 iframe 的 srcdoc，纯静态脚本（无 AI 代码内联）；改回传协议要同步 controller.ts
 *
 * 隔离：iframe 用 sandbox="allow-scripts"（无 allow-same-origin → opaque origin），
 * AI 代码跑在 null origin 里，碰不到父站 cookie/DOM。依赖走 esm.sh（CORS *）。
 * 上线需进一步独立 origin 部署（见 CLAUDE.md），本地 MVP 先用 sandbox 属性。
 */

export const RUNNER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0}
  body{font-family:-apple-system,"PingFang SC",sans-serif;padding:0}
  #root{padding:0}
</style>
<style id="project-css"></style>
</head>
<body>
<div id="root"></div>
<script>
const post = (m) => parent.postMessage(m, "*");

// 当前这一轮是否已报错（防止报错后又误发 RENDER_OK）
let runFailed = false;
let currentRunId = 0;
let activeImportMapKey = "";
function fail(message, stack) {
  runFailed = true;
  post({ type: "RUNTIME_ERROR", runId: currentRunId, message: String(message || "未知错误"), stack: String(stack || "") });
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

function resetRoot() {
  const oldRoot = document.getElementById("root");
  const nextRoot = document.createElement("div");
  nextRoot.id = "root";
  if (oldRoot) oldRoot.replaceWith(nextRoot);
  else document.body.prepend(nextRoot);
}

function resetModuleTags() {
  document.querySelectorAll("script[data-project-module]").forEach((node) => node.remove());
}

window.__WEB_CURSOR_REPORT_RENDER_OK__ = (runId) => {
  setTimeout(() => {
    if (runId === currentRunId && !runFailed) post({ type: "RENDER_OK", runId });
  }, 0);
};

function ensureImportMap(importMap) {
  const normalizedImportMap = importMap || { imports: {} };
  const nextKey = JSON.stringify(normalizedImportMap);
  if (activeImportMapKey === nextKey) return true;
  if (activeImportMapKey) {
    fail("运行时依赖版本已变化，需要刷新沙箱后重试", "");
    return false;
  }

  const script = document.createElement("script");
  script.type = "importmap";
  script.dataset.projectImportmap = "true";
  script.textContent = nextKey;
  document.head.appendChild(script);
  activeImportMapKey = nextKey;
  return true;
}

window.addEventListener("message", async (e) => {
  const d = e.data;
  if (!d || d.type !== "RUN") return;
  const runId = Number(d.runId);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    fail("预览运行协议错误：缺少合法 runId", "");
    return;
  }
  currentRunId = runId;
  runFailed = false;
  try {
    const project = d.project || {};
    document.getElementById("project-css").textContent = String(project.css || "");
    resetModuleTags();
    if (!ensureImportMap(project.importMap)) return;
    resetRoot();

    const source = String(project.js || "")
      + "\\n\\nwindow.__WEB_CURSOR_REPORT_RENDER_OK__("
      + JSON.stringify(runId)
      + ");\\n";
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.dataset.projectModule = "true";
    script.onload = () => {
      URL.revokeObjectURL(url);
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      fail("加载项目模块失败", "");
    };
    document.body.appendChild(script);
  } catch (err) {
    fail(err && err.message ? err.message : err, err && err.stack);
  }
});

post({ type: "SANDBOX_READY" });
</script>
</body>
</html>`;
