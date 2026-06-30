import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isAppLocale, localeFromLanguageTag, type AppLocale } from "./locales";

function localeFromAcceptLanguage(value: string | null): AppLocale | null {
  if (!value) return null;

  return value
    .split(",")
    .map((item) => {
      const [tag, qValue] = item.trim().split(";q=");
      const q = qValue === undefined ? 1 : Number(qValue);
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .toSorted((a, b) => b.q - a.q)
    .map(({ tag }) => localeFromLanguageTag(tag))
    .find((locale): locale is AppLocale => Boolean(locale)) ?? null;
}

async function resolveLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  if (isAppLocale(cookieLocale)) return cookieLocale;

  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language")) ?? defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
