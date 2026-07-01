/**
 * [INPUT]: 当前 owner 的项目列表
 * [OUTPUT]: 有项目显示项目首页；无项目显示原始三栏工作台
 * [POS]: B 域入口路由 —— 只做入口分流，不承载项目工作台状态
 * [PROTOCOL]: /p/[projectId] 才是历史会话工作台；首次用户没有项目时仍从 / 直接开始。
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { req } from "@/lib/api";
import type { Project } from "@/lib/projectTypes";
import ProjectHome from "@/components/project/ProjectHome";
import Workbench from "@/components/Workbench";

function EntrySkeleton() {
  return (
    <div className="h-screen bg-bg">
      <div className="h-12 border-b border-border bg-panel px-4 flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-accent/70 animate-pulse" />
        <div className="h-4 w-28 rounded bg-panel2 animate-pulse" />
        <div className="h-3 w-24 rounded bg-panel2 animate-pulse" />
      </div>
      <main className="px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="h-6 w-28 rounded bg-panel2 animate-pulse" />
              <div className="mt-3 h-3 w-80 rounded bg-panel2 animate-pulse" />
            </div>
            <div className="h-9 w-24 rounded-md bg-accent/40 animate-pulse" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="min-h-[132px] rounded-lg border border-border bg-panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div className="h-9 w-9 rounded-md bg-panel2 animate-pulse" />
                  <div className="h-3 w-20 rounded bg-panel2 animate-pulse" />
                </div>
                <div className="h-4 w-32 rounded bg-panel2 animate-pulse" />
                <div className="mt-3 h-3 w-44 rounded bg-panel2 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await req<Project[]>("GET", "/api/projects"));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  if (loading) {
    return <EntrySkeleton />;
  }

  return projects.length > 0 ? <ProjectHome initialProjects={projects} /> : <Workbench />;
}
