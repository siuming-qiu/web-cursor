/**
 * [INPUT]: published showcase cases from DB
 * [OUTPUT]: 首页入口，案例摘要服务端预取，历史项目由客户端按 owner 拉取
 * [POS]: B 域入口路由外壳 —— 不承载工作台状态，只装配首页数据
 * [PROTOCOL]: 首页生成仍复用 Workbench + /api/chat，不新增会话创建契约。
 */
import HomePage from "@/components/project/HomePage";
import { listPublishedShowcaseCases } from "@/server/showcase";

export const revalidate = 300;

export default async function Page() {
  const showcases = await listPublishedShowcaseCases();
  return <HomePage showcases={showcases.slice(0, 3)} />;
}
