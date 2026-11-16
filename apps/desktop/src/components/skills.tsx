// Shared pieces of every list of skills: a search box, the filter behind it and the list under titles
// (WorkStudio, OpenBlocks, Claude Code, Codex…). Used by the chat, projects, automations and settings.
import { useMemo, useState, type ReactNode } from "react";
import { Search } from "./icons";
import { useT } from "../lib/i18n";
import type { Skill } from "../lib/api";

export const groupOf = (s: Skill) => s.group || "Skills";

/** Skills whose name, description or title contain every word typed. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return skills;
  return skills.filter((s) => {
    const hay = `${s.name} ${s.description} ${groupOf(s)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function useSkillSearch(skills: Skill[]) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterSkills(skills, query), [skills, query]);
  return { query, setQuery, shown };
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const t = useT();
  return (
    <label className="skill-search">
      <Search />
      <input type="search" value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={placeholder ?? t("Buscar skills…")} aria-label={placeholder ?? t("Buscar skills…")} />
    </label>
  );
}

/** The list under one title per group; `render` draws each skill. Shows a line when nothing matches. */
export function GroupedSkills({ items, render, empty }: { items: Skill[]; render: (s: Skill, i: number) => ReactNode; empty?: string }) {
  const t = useT();
  if (!items.length) return <div className="skill-none small muted">{empty ?? t("Ninguna skill coincide.")}</div>;
  let last = "";
  return (
    <>
      {items.map((s, i) => {
        const g = groupOf(s);
        const head = g !== last;
        last = g;
        return (
          <div key={s.path} className="skill-item">
            {head && <div className="menu-label group-title">{g}</div>}
            {render(s, i)}
          </div>
        );
      })}
    </>
  );
}
