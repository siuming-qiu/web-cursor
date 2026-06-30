"use client";

import { isValidElement, type ReactNode, useState } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("Common");
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!navigator.clipboard || !value.trim()) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      className="absolute right-2 top-2 rounded-md border border-border bg-codebg/85 px-2 py-1 text-[11px] font-medium text-muted opacity-0 transition hover:border-accent hover:text-accent group-hover:opacity-100"
      onClick={copy}
      aria-label={t("copy")}
      title={t("copy")}
    >
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

const markdownComponents: Components = {
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  pre({ children, ...props }) {
    const raw = nodeText(children);
    return (
      <div className="group relative my-3">
        <pre {...props}>{children}</pre>
        <CopyButton value={raw} />
      </div>
    );
  },
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  );
}
