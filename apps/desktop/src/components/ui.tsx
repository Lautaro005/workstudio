import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot, Box, Brain, Check, CircleAlert, Copy, Info, NotebookPen, Sparkles, SquareTerminal, GitBranch, Cpu, Gem, MousePointer2, RefreshCw, Bell, Plug,
} from "lucide-react";
import { useStore } from "../lib/store";
import { locale, resolveLang, tt } from "../lib/i18n";

const ICONS: Record<string, typeof Box> = {
  brain: Brain,
  bot: Bot,
  notebook: NotebookPen,
  sparkles: Sparkles,
  terminal: SquareTerminal,
  github: GitBranch,
  cpu: Cpu,
  gem: Gem,
  cursor: MousePointer2,
  box: Box,
};

/** Logos in public/brands. "mono" ones are black and get inverted in dark mode; "tile" ones are full app icons. */
export const BRANDS: Record<string, { src: string; kind: "mono" | "tile" }> = {
  anthropic: { src: "brands/anthropic.png", kind: "mono" },
  openai: { src: "brands/openai.png", kind: "mono" },
  gemini: { src: "brands/gemini.png", kind: "mono" },
  ollama: { src: "brands/ollama.png", kind: "mono" },
  grok: { src: "brands/grok.png", kind: "mono" },
  lmstudio: { src: "brands/lmstudio.png", kind: "mono" },
  openrouter: { src: "brands/openrouter.svg", kind: "mono" },
  muse: { src: "brands/muse.png", kind: "mono" },
  cheaperinference: { src: "brands/cheaperinference.png", kind: "mono" },
  lumina: { src: "brands/lumina.svg", kind: "tile" },
  opencue: { src: "brands/opencue.svg", kind: "tile" },
};

export function BrandImg({ name, className = "" }: { name: string; className?: string }) {
  const b = BRANDS[name];
  if (!b) return null;
  return <img className={`brand-img ${b.kind} ${className}`} src={b.src} alt="" draggable={false} />;
}

export function AppIcon({ name, size }: { name: string; size?: number }) {
  if (BRANDS[name]) return <BrandImg name={name} />;
  const I = ICONS[name] ?? Box;
  return <I size={size} strokeWidth={1.9} />;
}

const COLORS = ["clay", "olive", "mustard", "ink"];
export const tone = (c: string) => (COLORS.includes(c) ? c : "ink");

export function Glyph({ icon, color, className = "", style }: { icon: string; color: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`glyph ${tone(color)} ${BRANDS[icon] ? `has-brand ${BRANDS[icon].kind}` : ""} ${className}`} style={style}>
      <AppIcon name={icon} />
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect x="64" y="64" width="896" height="896" rx="216" fill="#C2410C" />
      <rect x="224" y="224" width="264" height="264" rx="64" fill="#FAF7F2" />
      <rect x="536" y="224" width="264" height="264" rx="64" fill="#CA8A04" />
      <rect x="224" y="536" width="264" height="264" rx="64" fill="#3F6212" />
      <rect x="536" y="536" width="264" height="264" rx="132" fill="#FAF7F2" fillOpacity="0.92" />
    </svg>
  );
}

export function Dot({ state }: { state: "on" | "off" | "busy" | "idle" }) {
  return <span className={`dot ${state === "idle" ? "" : state}`} />;
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** Hides the embedded app webviews while an overlay is open (they would sit on top of it). */
export function useOverlay(open: boolean) {
  const overlay = useStore((s) => s.overlay);
  useEffect(() => {
    if (!open) return;
    overlay(true);
    return () => overlay(false);
  }, [open, overlay]);
}

export function Modal({ open, onClose, children, wide, className = "" }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useOverlay(open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""} ${className}`} role="dialog">
        {children}
      </div>
    </div>
  );
}

/** Closes on outside click / Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    setTimeout(() => window.addEventListener("mousedown", down), 0);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function CopyLine({ text, dark = true }: { text: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  const toast = useStore((s) => s.toast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      toast(tt("No pude copiar al portapapeles"), "error");
    }
  };
  return (
    <div className={dark ? "code-line" : "code"} style={dark ? undefined : { display: "flex", alignItems: "center", gap: 8 }}>
      <span title={text}>{text}</span>
      <button className="icon-btn sm" onClick={copy} aria-label={tt("Copiar")}>
        {done ? <Check /> : <Copy />}
      </button>
    </div>
  );
}

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return tt("recién");
  const m = Math.round(s / 60);
  if (m < 60) return tt("hace {n} min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tt("hace {n} h", { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return tt("hace {n} d", { n: d });
  const lang = resolveLang(useStore.getState().settings?.language as string | undefined);
  return new Date(ts).toLocaleDateString(locale(lang), { day: "numeric", month: "short" });
}

export function NoteIcon({ kind, app }: { kind: string; app: string }) {
  const apps = useStore((s) => s.apps);
  const def = apps.find((a) => a.id === app);
  if (def) return <Glyph icon={def.icon} color={def.color} />;
  const map: Record<string, [typeof Box, string]> = {
    success: [Check, "olive"],
    warning: [CircleAlert, "mustard"],
    update: [RefreshCw, "mustard"],
    activity: [Bell, "clay"],
    info: [Info, "ink"],
  };
  const [I, c] = map[kind] ?? [Plug, "ink"];
  return (
    <span className={`glyph ${c}`}>
      <I />
    </span>
  );
}

export const termLook = (profile: string): { icon: string; color: string } => {
  const map: Record<string, [string, string]> = {
    claude: ["anthropic", "clay"],
    codex: ["openai", "ink"],
    gemini: ["gemini", "mustard"],
    "cursor-agent": ["cursor", "ink"],
    brain: ["brain", "clay"],
    lumina: ["lumina", "mustard"],
    opencue: ["opencue", "olive"],
    shell: ["terminal", "ink"],
  };
  const [icon, color] = map[profile] ?? ["terminal", "ink"];
  return { icon, color };
};
