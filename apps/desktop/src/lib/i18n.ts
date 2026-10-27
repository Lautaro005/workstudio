// Spanish is the source language: every UI string is written in Spanish and looked up here for
// English. `{name}` placeholders are filled from the second argument.
import { useStore } from "./store";
import { EN } from "./en";

export type Lang = "es" | "en";

export function resolveLang(setting?: string | null): Lang {
  if (setting === "es" || setting === "en") return setting;
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("es") ? "es" : "en";
}

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, s: string, vars?: Record<string, string | number>) {
  const base = lang === "en" ? EN[s] ?? s : s;
  return fill(base, vars);
}

export type T = (s: string, vars?: Record<string, string | number>) => string;

/** For components: re-renders when the language changes. */
export function useT(): T {
  const lang = useStore((s) => resolveLang(s.settings?.language as string | undefined));
  return (s, vars) => translate(lang, s, vars);
}

export function useLang(): Lang {
  return useStore((s) => resolveLang(s.settings?.language as string | undefined));
}

/** Outside components (store actions, helpers). */
export function tt(s: string, vars?: Record<string, string | number>) {
  return translate(resolveLang(useStore.getState().settings?.language as string | undefined), s, vars);
}

export const locale = (lang: Lang) => (lang === "en" ? "en-US" : "es-AR");

/** Catalog texts: English variants live next to the Spanish ones. */
export function appText(app: { tagline: string; description: string; tagline_en?: string; description_en?: string }, lang: Lang) {
  return {
    tagline: lang === "en" && app.tagline_en ? app.tagline_en : app.tagline,
    description: lang === "en" && app.description_en ? app.description_en : app.description,
  };
}
