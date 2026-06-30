import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Workbench from "@/components/Workbench";

type PageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return {
    title: t("projectTitle"),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  return <Workbench projectId={projectId} />;
}
