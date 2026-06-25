"use client";

import Editor from "@monaco-editor/react";

export default function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Editor
      height="100%"
      language="typescript"
      path={path}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      onMount={(_editor, monaco) => {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
      }}
      options={{
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
