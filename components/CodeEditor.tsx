/**
 * 真 Monaco 编辑器（@monaco-editor/react）。一期只读展示 AI 写的代码。
 * 关掉 TS 语义校验：避免把 esm.sh 解析的 React 类型缺失误报成红波浪。
 */
"use client";

import Editor from "@monaco-editor/react";

export default function CodeEditor({ value }: { value: string }) {
  return (
    <Editor
      height="100%"
      language="typescript"
      path="App.tsx"
      theme="vs-dark"
      value={value}
      onMount={(_editor, monaco) => {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
      }}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 12.7,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "off",
        renderLineHighlight: "none",
        padding: { top: 12 },
      }}
    />
  );
}
