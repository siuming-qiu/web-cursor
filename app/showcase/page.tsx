import type { Metadata } from "next";
import Link from "next/link";
import { listPublishedShowcaseCases } from "@/server/showcase";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Web Cursor 案例展示",
  description: "查看 Web Cursor 从真实对话生成 React 项目的只读案例。",
  alternates: {
    canonical: "/showcase",
  },
};

export default async function ShowcaseIndexPage() {
  const cases = await listPublishedShowcaseCases();

  return (
    <main className="min-h-screen bg-[#080807] text-[#f7f4ec]">
      <section className="border-b border-[#29241d] px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <nav className="flex h-12 items-center justify-between gap-4">
            <Link href="/" className="font-mono text-[13px] font-semibold text-[#f25516]">
              Web Cursor
            </Link>
            <Link href="/" className="rounded-md border border-[#3b3328] px-3 py-2 text-sm text-[#f7f4ec] transition hover:border-[#f25516]">
              打开工作台
            </Link>
          </nav>

          <div className="py-16">
            <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9d927f]">Showcase</p>
            <h1 className="mt-5 max-w-4xl text-4xl font-normal leading-[1.06] sm:text-6xl">
              真实对话生成的 React 项目案例
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-[#b7aa96]">
              每个案例都来自数据库里的真实项目与会话。页面只读展示对话、代码和浏览器内 WebContainer 预览，不允许访客修改或继续对话。
            </p>
          </div>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          {cases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#29241d] bg-[#12100d] p-8 text-sm leading-7 text-[#b7aa96]">
              还没有发布案例。向 <code className="font-mono text-[#f25516]">showcase_cases</code> 插入 published 记录后会显示在这里。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {cases.map((item) => (
                <Link
                  key={item.slug}
                  href={`/showcase/${item.slug}`}
                  className="group min-h-[190px] rounded-xl border border-[#29241d] bg-[#12100d] p-5 transition hover:-translate-y-0.5 hover:border-[#f25516] hover:bg-[#17130f]"
                >
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <span className="rounded-full border border-[#3b3328] bg-[#080807] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#9d927f]">
                      {item.projectTitle}
                    </span>
                    <span className="text-[11px] text-[#756b5d]">
                      {new Date(item.publishedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  <h2 className="text-xl font-semibold leading-snug text-[#f7f4ec] group-hover:text-[#ff6b2c]">
                    {item.title}
                  </h2>
                  <p className="mt-3 line-clamp-3 text-sm leading-7 text-[#b7aa96]">
                    {item.description || item.conversationTitle || "查看这个真实对话如何生成可运行的 React 项目。"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
