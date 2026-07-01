import type { AttachmentSummary } from "@/types/attachment";
import type { ImageRunView } from "@/lib/types";

export type ShowcaseListItem = {
  slug: string;
  title: string;
  description?: string;
  projectTitle: string;
  conversationTitle?: string;
  publishedAt: string;
};

export type ShowcaseFile = {
  path: string;
  content: string;
  updatedAt: string;
};

export type ShowcaseMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: {
    attachments?: AttachmentSummary[];
    [key: string]: unknown;
  };
  imageRuns?: ImageRunView[];
};

export type ShowcaseDetail = ShowcaseListItem & {
  files: ShowcaseFile[];
  messages: ShowcaseMessage[];
};
