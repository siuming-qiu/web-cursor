/**
 * [INPUT]: 当前 owner 的 projects
 * [OUTPUT]: 项目列表入口；创建/点击项目后进入 /p/[projectId]
 * [POS]: B 域项目首页 —— 只管理项目列表，不承载工作台状态
 * [PROTOCOL]: 空项目用户不渲染本组件；app/page.tsx 会直接渲染无项目工作台。
 */
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { req } from "@/lib/api";
import type { Project } from "@/lib/projectTypes";
import { formatTime, normalizeCreatedProject } from "@/lib/projectTypes";
import TopBar from "@/components/TopBar";
import Toast from "@/components/Toast";

export default function ProjectHome({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  }

  const createProject = useCallback(async () => {
    try {
      const project = normalizeCreatedProject(await req<Project | Project[]>("POST", "/api/projects", { title: "untitled" }));
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      router.push(`/p/${project.id}`);
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e));
    }
  }, [router]);

  return (
    <div className="h-screen flex flex-col">
      <TopBar
        projName="我的项目"
        canAct={false}
        onRerun={() => {}}
        onExport={() => {}}
      />

      <main className="flex-1 min-h-0 overflow-y-auto bg-bg px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Workspace</p>
              <h1 className="m-0 text-[32px] font-normal leading-tight text-fg">我的项目</h1>
              <p className="mt-2 text-[13px] text-muted">
                项目保存一份代码库；项目下的多条会话线索共享当前代码。
              </p>
            </div>
            <button
              className="rounded-lg border border-accent bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#d04200]"
              onClick={createProject}
            >
              ＋ 新建项目
            </button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                className="min-h-[148px] rounded-xl border border-border bg-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-accent hover:bg-panel2"
                onClick={() => router.push(`/p/${project.id}`)}
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-codebg text-[18px] text-accent">⌘</span>
                  <span className="text-[11px] text-muted">{formatTime(project.updatedAt ?? project.createdAt)}</span>
                </div>
                <div className="truncate text-[15px] font-semibold text-fg">{project.title}</div>
                <div className="mt-2 text-[12px] text-muted">打开项目查看历史会话和最后代码</div>
              </button>
            ))}
          </div>
        </div>
      </main>
      <Toast message={toast} />
    </div>
  );
}
