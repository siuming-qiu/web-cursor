import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Web Cursor · AI React Playground",
  description: "浏览器内的 AI React 编码沙箱：自然语言 → AI 写码 → 即时执行 → 自我修复",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
