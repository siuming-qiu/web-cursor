import type { Metadata } from "next";
import CallbackClient from "./CallbackClient";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const OAuthCallbackStatus = {
  Success: "success",
  Error: "error",
} as const;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function callbackStatus(value: string) {
  return value === OAuthCallbackStatus.Success ? OAuthCallbackStatus.Success : OAuthCallbackStatus.Error;
}

export const metadata: Metadata = {
  title: "Figma OAuth Callback",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FigmaOAuthCallbackPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <CallbackClient
      status={callbackStatus(first(params.status))}
      returnTo={first(params.returnTo) || "/"}
      code={first(params.code)}
      message={first(params.message)}
    />
  );
}
