export const locales = ["zh", "en"] as const;
export const localeHeaderName = "x-locale";

export type AppLocale = typeof locales[number];

export const defaultLocale: AppLocale = "zh";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.includes(value as AppLocale);
}

export function localeFromLanguageTag(value: string): AppLocale | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}
