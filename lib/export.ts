/**
 * [INPUT]: 当前项目文件列表 + 项目标题
 * [OUTPUT]: 一个自包含 .html 字符串，浏览器打开即运行（依赖走 esm.sh CDN，对应一期 D1 选 B）
 * [POS]: B 域导出（R7）。真导出——产物是能独立运行的文件，不是截图
 */
"use client";

import { compileProject, type TranspileProjectFile } from "./transpile";

const REACT = "https://esm.sh/react@18.3.1";
const REACT_DOM_CLIENT = "https://esm.sh/react-dom@18.3.1/client";
const JSX_RUNTIME = "https://esm.sh/react@18.3.1/jsx-runtime";

// UTF-8 安全的 base64（中文不会乱码）
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** 项目文件 → 自包含可运行 HTML。代码用 data URL 引入，彻底避开 </script> 转义问题。 */
export async function buildExportHtml(files: TranspileProjectFile[], title: string): Promise<string> {
  const compiled = await compileProject(files);
  const dataUrl = `data:text/javascript;base64,${toBase64(compiled.js)}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script type="importmap">
{"imports":{"react":"${REACT}","react-dom/client":"${REACT_DOM_CLIENT}","react/jsx-runtime":"${JSX_RUNTIME}"}}
</script>
<style>html,body{margin:0;font-family:-apple-system,"PingFang SC",sans-serif}</style>
<style>${compiled.css}</style>
</head>
<body>
<div id="root"></div>
<script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
const mod = await import("${dataUrl}");
if (typeof mod.default === "function") {
  createRoot(document.getElementById("root")).render(React.createElement(mod.default));
}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
