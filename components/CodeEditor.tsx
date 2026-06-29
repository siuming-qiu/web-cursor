"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useRef } from "react";

function languageForPath(path: string) {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  return "typescript";
}

export default function CodeEditor({
  path,
  value,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}) {
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  return (
    <Editor
      height="100%"
      language={languageForPath(path)}
      path={path}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      onMount={(editor, monaco) => {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());
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
