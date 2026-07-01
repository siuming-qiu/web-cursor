import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShowcaseWorkbench from "@/components/showcase/ShowcaseWorkbench";
import { getPublishedShowcaseCase, listPublishedShowcaseCases } from "@/server/showcase";

export const revalidate = 300;
export const dynamicParams = true;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const cases = await listPublishedShowcaseCases();
  return cases.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getPublishedShowcaseCase(slug);
  if (!detail) {
    return {
      title: "案例不存在",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${detail.title} · Web Cursor 案例`,
    description: detail.description ?? `查看 ${detail.title} 的只读 Web Cursor 生成案例。`,
    alternates: {
      canonical: `/showcase/${detail.slug}`,
    },
    openGraph: {
      title: detail.title,
      description: detail.description ?? "Web Cursor 真实对话生成案例。",
      url: `/showcase/${detail.slug}`,
    },
  };
}

export default async function ShowcaseCasePage({ params }: PageProps) {
  const { slug } = await params;
  const detail = await getPublishedShowcaseCase(slug);
  if (!detail) notFound();

  return <ShowcaseWorkbench detail={detail} />;
}
