import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "关于 Web Cursor",
  description: "Web Cursor 是一个浏览器内 AI React Playground：自然语言生成 React 项目，在隔离 iframe 中即时预览，并把运行结果反馈给 agent loop 自动修复。",
  alternates: {
    canonical: "/about",
  },
  openGraph: {
    title: "关于 Web Cursor",
    description: "浏览器内 AI React 编码沙箱：生成、运行、观察、修复 React UI 的完整闭环。",
    url: "/about",
  },
};

const capabilities = [
  ["自然语言生成 React", "把一句产品需求、界面描述或 Figma 链接转成完整 React 项目文件，而不是只吐一段代码片段。"],
  ["真实浏览器预览", "生成结果会在 iframe sandbox 中编译运行，页面是否能渲染由真实运行结果决定。"],
  ["运行反馈驱动修复", "编译错误、运行错误、console 和渲染状态会回填给 agent，下一轮继续修复。"],
  ["服务端持有模型密钥", "LLM 调用只发生在 Next.js Route Handler 中，浏览器端不会接触 API key。"],
];

const flow = [
  ["1", "Describe", "用户描述要做的 React UI，或粘贴带 node-id 的 Figma 设计链接。"],
  ["2", "Generate", "服务端 agent 读取上下文，通过文件工具写入 Vite React TypeScript 项目。"],
  ["3", "Preview", "浏览器 workbench 编译项目，并在隔离 iframe 里运行生成结果。"],
  ["4", "Repair", "真实错误作为 tool result 回传，agent 基于结果继续修复直到可运行。"],
];

const boundaries = [
  ["A 域 · LLM Agent", "Next.js Route Handler 持有模型密钥、读取 transcript、调用工具并流式返回结果。"],
  ["B 域 · Workbench", "浏览器主线程管理聊天、文件、编译、预览状态和用户交互。"],
  ["C 域 · Sandbox", "iframe 执行 AI 生成的不可信代码，并回传 RENDER_OK、RUNTIME_ERROR 和 CONSOLE。"],
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#080807] text-[#f7f4ec]">
      <section className="border-b border-[#29241d] px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <nav className="flex h-12 items-center justify-between gap-4">
            <Link href="/" className="font-mono text-[13px] font-semibold text-[#f25516]">
              Web Cursor
            </Link>
            <div className="flex items-center gap-2 text-sm">
              <Link href="/ai-react-playground" className="text-[#b7aa96] transition hover:text-[#f7f4ec]">
                AI React Playground
              </Link>
              <Link href="/" className="rounded-md bg-[#f25516] px-3 py-2 font-medium text-white transition hover:bg-[#d84810]">
                打开工作台
              </Link>
            </div>
          </nav>

          <div className="grid min-h-[72vh] items-center gap-12 py-16 lg:grid-cols-[1fr_0.82fr]">
            <div>
              <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9d927f]">About Web Cursor</p>
              <h1 className="mt-5 max-w-4xl text-4xl font-normal leading-[1.06] sm:text-6xl lg:text-[76px]">
                浏览器内的 AI React 编码沙箱
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-[#c7bca8]">
                Web Cursor 把 AI 生成代码、浏览器编译预览和运行错误反馈连成一个闭环。用户只需要描述目标界面，agent 会写项目文件、运行预览，并根据真实结果继续修复。
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/" className="rounded-md bg-[#f25516] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d84810]">
                  进入 Playground
                </Link>
                <Link href="/ai-react-playground" className="rounded-md border border-[#3b3328] px-5 py-3 text-sm font-semibold text-[#f7f4ec] transition hover:border-[#f25516]">
                  查看英文介绍页
                </Link>
              </div>
            </div>

            <div className="border border-[#29241d] bg-[#12100d] p-4">
              <div className="border-b border-[#29241d] pb-3 font-mono text-[12px] text-[#9d927f]">agent-loop.snapshot</div>
              <div className="mt-4 space-y-3">
                {flow.map(([step, label, body]) => (
                  <div key={label} className="grid grid-cols-[42px_1fr] gap-3 border border-[#29241d] bg-[#18150f] p-4">
                    <div className="font-mono text-2xl text-[#f25516]">{step}</div>
                    <div>
                      <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.08em] text-[#f7f4ec]">{label}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#b7aa96]">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#29241d] px-5 py-20 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-normal leading-tight sm:text-4xl">核心能力</h2>
            <p className="mt-4 text-sm leading-7 text-[#b7aa96]">
              Web Cursor 的重点不是“展示 AI 生成了代码”，而是把生成结果放进真实运行环境里验证。
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {capabilities.map(([title, body]) => (
              <article key={title} className="border border-[#29241d] bg-[#12100d] p-6">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#b7aa96]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <h2 className="text-3xl font-normal leading-tight sm:text-4xl">三执行域边界</h2>
            <p className="mt-4 text-sm leading-7 text-[#b7aa96]">
              LLM、浏览器编排和不可信代码执行被分离，这个边界决定了安全模型和可修复闭环。
            </p>
          </div>
          <div className="space-y-3">
            {boundaries.map(([title, body]) => (
              <article key={title} className="border border-[#29241d] bg-[#12100d] p-5">
                <h3 className="font-mono text-sm font-semibold text-[#f25516]">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-[#b7aa96]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
