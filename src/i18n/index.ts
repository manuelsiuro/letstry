import { en } from "./en";
import { fr } from "./fr";
import { getItem, setItem } from "../platform/storage";

export type Locale = "en" | "fr";
type Dict = Record<string, string>;

const DICTS: Record<Locale, Dict> = { en, fr };
export const LOCALE_STORAGE_KEY = "cpd.locale";

let current: Locale = "en";
const listeners = new Set<(locale: Locale) => void>();

function detectInitialLocale(): Locale {
  const saved = getItem(LOCALE_STORAGE_KEY);
  if (saved === "en" || saved === "fr") return saved;
  const nav = typeof navigator !== "undefined" ? navigator.language ?? "" : "";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function initI18n(): void {
  current = detectInitialLocale();
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  setItem(LOCALE_STORAGE_KEY, locale);
  for (const fn of listeners) fn(locale);
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let str = dict[key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return str;
}
