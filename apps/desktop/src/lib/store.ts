import { create } from "zustand";
import { tt } from "./i18n";
import { call, on, type AppDef, type AppInfo, type AppStatus, type CliDef, type LaunchInfo, type Note, type Settings, type UpdateInfo } from "./api";

export type Pane = {
  id: string;
  profile: string;
  title: string;
  cwd: string;
  initial: string;
  /** Changes when the pane is restarted, so the terminal re-spawns. */
  nonce: number;
  exited?: boolean;
  mcp?: number;
};

export type Toast = { id: number; kind: "info" | "success" | "error"; text: string };

/** A chat answer while it streams in. */
export type Live = { text: string; tools: { name: string; done: boolean }[]; running: boolean; error?: boolean };

export const MAX_PANES = 6;

type State = {
  ready: boolean;
  route: string;
  apps: AppDef[];
  clis: CliDef[];
  statuses: Record<string, AppStatus>;
  notes: Note[];
  updates: UpdateInfo[];
  settings: Settings | null;
  info: AppInfo | null;
  launch: LaunchInfo | null;
  panes: Pane[];
  focusPane: string | null;
  overlays: number;
  toasts: Toast[];
  busy: Record<string, string>;
  selfUpdate: { version: string; notes?: string } | null;
  /** Set when something asks to open an app on its own interface (not its details). */
  appIntent: string | null;
  chatLive: Record<string, Live>;
  /** Bumps when a chat answer ends, so views reload it from disk. */
  chatTick: number;

  init: () => Promise<void>;
  go: (route: string) => void;
  openApp: (id: string) => void;
  takeAppIntent: (id: string) => boolean;
  chatStarted: (id: string) => void;
  reloadCatalog: () => Promise<void>;
  refresh: (versions?: boolean) => Promise<void>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  overlay: (open: boolean) => void;
  checkUpdates: (force?: boolean) => Promise<void>;
  reloadNotes: () => Promise<void>;
  refreshLaunch: () => Promise<LaunchInfo | null>;
  addPane: (profile: string, opts?: Partial<Pane>) => Promise<string | null>;
  runCommand: (title: string, command: string, cwd?: string) => Promise<void>;
  closePane: (id: string) => void;
  restartPane: (id: string) => void;
  patchPane: (id: string, patch: Partial<Pane>) => void;
  setFocus: (id: string | null) => void;
};

let toastId = 1;
let paneSeq = 1;

const q = (s: string) => (navigator.userAgent.includes("Windows") ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, "'\\''")}'`);

export type Profile = { id: string; name: string; group: "Agentes" | "Apps" | "Sistema"; bin?: string; hint: string; mcp: "auto" | "workspace" | "none" };
// Hints are Spanish source strings; views pass them through t().

export const PROFILES: Profile[] = [
  { id: "shell", name: "Terminal", group: "Sistema", hint: "Tu shell, en tu carpeta personal", mcp: "none" },
  { id: "claude", name: "Claude Code", group: "Agentes", bin: "claude", hint: "Con el servidor de WorkStudio por --mcp-config", mcp: "auto" },
  { id: "codex", name: "Codex", group: "Agentes", bin: "codex", hint: "Con el servidor de WorkStudio por -c", mcp: "auto" },
  { id: "gemini", name: "Gemini CLI", group: "Agentes", bin: "gemini", hint: "Lee .gemini/settings.json del workspace", mcp: "workspace" },
  { id: "cursor-agent", name: "Cursor Agent", group: "Agentes", bin: "cursor-agent", hint: "Lee .cursor/mcp.json del workspace", mcp: "workspace" },
  { id: "brain", name: "brain", group: "Apps", bin: "brain", hint: "En ~/.brain, con la ayuda del comando", mcp: "none" },
  { id: "lumina", name: "lumina", group: "Apps", bin: "lumina", hint: "Chequeo de micrófonos y modelos", mcp: "none" },
  { id: "opencue", name: "opencue", group: "Apps", bin: "opencue", hint: "El binario de OpenCue", mcp: "none" },
];

function profileLaunch(profile: string, launch: LaunchInfo | null): { title: string; cwd: string; initial: string; mcp?: number } {
  const ws = launch?.workspace ?? "";
  const n = launch?.count ?? 0;
  switch (profile) {
    case "claude":
      return { title: "Claude Code", cwd: ws, initial: launch ? `claude --mcp-config ${q(launch.claude_config)}` : "claude", mcp: n };
    case "codex":
      return { title: "Codex", cwd: ws, initial: ["codex", ...(launch?.codex_args ?? []).map((a) => (a === "-c" ? a : q(a)))].join(" "), mcp: n };
    case "gemini":
      return { title: "Gemini CLI", cwd: ws, initial: "gemini", mcp: n };
    case "cursor-agent":
      return { title: "Cursor Agent", cwd: ws, initial: "cursor-agent", mcp: n };
    case "brain":
      return { title: "brain", cwd: "~/.brain", initial: "brain help" };
    case "lumina":
      return { title: "lumina", cwd: "~/.lumina", initial: "lumina doctor" };
    case "opencue":
      return { title: "opencue", cwd: "~", initial: "opencue --version" };
    default:
      return { title: "Terminal", cwd: "~", initial: "" };
  }
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  route: "home",
  apps: [],
  clis: [],
  statuses: {},
  notes: [],
  updates: [],
  settings: null,
  info: null,
  launch: null,
  panes: [],
  focusPane: null,
  overlays: 0,
  toasts: [],
  busy: {},
  selfUpdate: null,
  appIntent: null,
  chatLive: {},
  chatTick: 0,

  async init() {
    const [cat, sts, notes, updates, settings, info] = await Promise.all([
      call<{ apps: AppDef[]; clis: CliDef[] }>("get_catalog"),
      call<AppStatus[]>("get_statuses", { refresh: true }),
      call<Note[]>("notes_list"),
      call<UpdateInfo[]>("updates_get"),
      call<Settings>("settings_get"),
      call<AppInfo>("app_info"),
    ]);
    set({
      apps: cat.apps,
      clis: cat.clis,
      statuses: Object.fromEntries(sts.map((s) => [s.id, s])),
      notes,
      updates,
      settings,
      info,
      ready: true,
    });
    on<AppStatus[]>("apps-status", (list) => set({ statuses: Object.fromEntries(list.map((s) => [s.id, s])) }));
    on<Note>("ws-notification", (n) => set((s) => ({ notes: [...s.notes.filter((x) => x.id !== n.id), n] })));
    on("ws-notes-changed", () => get().reloadNotes());
    on<UpdateInfo[]>("updates", (u) => set({ updates: u }));
    on<string>("navigate", (r) => get().go(r));
    on<{ chat: string; kind: string; text: string }>("chat-event", (ev) => {
      set((s) => {
        const cur: Live = s.chatLive[ev.chat] ?? { text: "", tools: [], running: true };
        let next: Live = cur;
        if (ev.kind === "delta") next = { ...cur, text: cur.text + ev.text, running: true };
        else if (ev.kind === "tool") next = { ...cur, tools: [...cur.tools, { name: ev.text, done: false }] };
        else if (ev.kind === "tool_done") next = { ...cur, tools: cur.tools.map((t) => (t.name === ev.text && !t.done ? { ...t, done: true } : t)) };
        if (ev.kind === "done" || ev.kind === "error") {
          const live = { ...s.chatLive };
          delete live[ev.chat];
          return { chatLive: live, chatTick: s.chatTick + 1 };
        }
        return { chatLive: { ...s.chatLive, [ev.chat]: next } };
      });
    });
    get().refreshLaunch();
    if (updates.length === 0) get().checkUpdates(false);
  },

  go(route) {
    set({ route });
  },

  openApp(id) {
    set({ route: `app:${id}`, appIntent: id });
  },

  takeAppIntent(id) {
    if (get().appIntent !== id) return false;
    set({ appIntent: null });
    return true;
  },

  chatStarted(id) {
    set((s) => ({ chatLive: { ...s.chatLive, [id]: { text: "", tools: [], running: true } } }));
  },

  async reloadCatalog() {
    const cat = await call<{ apps: AppDef[]; clis: CliDef[] }>("get_catalog");
    set({ apps: cat.apps, clis: cat.clis });
    await get().refresh(true);
  },

  async refresh(versions = false) {
    const sts = await call<AppStatus[]>("get_statuses", { refresh: versions });
    set({ statuses: Object.fromEntries(sts.map((s) => [s.id, s])) });
  },

  async start(id) {
    const app = get().apps.find((a) => a.id === id);
    set((s) => ({ busy: { ...s.busy, [id]: "start" } }));
    try {
      await call("app_start", { id });
      get().toast(app?.kind === "native" ? tt("Abriendo {name}", { name: app?.name ?? id }) : tt("{name} está iniciando", { name: app?.name ?? id }), "success");
    } catch (e) {
      get().toast(String(e), "error");
    } finally {
      set((s) => {
        const b = { ...s.busy };
        delete b[id];
        return { busy: b };
      });
      get().refresh(false);
    }
  },

  async stop(id) {
    set((s) => ({ busy: { ...s.busy, [id]: "stop" } }));
    try {
      await call("app_stop", { id });
    } catch (e) {
      get().toast(String(e), "error");
    } finally {
      set((s) => {
        const b = { ...s.busy };
        delete b[id];
        return { busy: b };
      });
      get().refresh(false);
    }
  },

  toast(text, kind = "info") {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6500 : 3800);
  },

  async saveSettings(patch) {
    const next = { ...(get().settings as Settings), ...patch };
    set({ settings: next });
    try {
      await call("settings_set", { value: next });
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  overlay(open) {
    set((s) => ({ overlays: Math.max(0, s.overlays + (open ? 1 : -1)) }));
  },

  async checkUpdates(force = true) {
    set((s) => ({ busy: { ...s.busy, updates: "check" } }));
    try {
      const u = await call<UpdateInfo[]>("updates_check", { force });
      set({ updates: u });
    } finally {
      set((s) => {
        const b = { ...s.busy };
        delete b.updates;
        return { busy: b };
      });
    }
  },

  async reloadNotes() {
    set({ notes: await call<Note[]>("notes_list") });
  },

  async refreshLaunch() {
    try {
      const launch = await call<LaunchInfo>("mcp_launch_info");
      set({ launch });
      return launch;
    } catch {
      return null;
    }
  },

  async addPane(profile, opts = {}) {
    if (get().panes.length >= MAX_PANES) {
      get().toast(tt("Hasta {n} terminales a la vez. Cerrá una para abrir otra.", { n: MAX_PANES }), "error");
      return null;
    }
    const launch = profile === "shell" ? get().launch : await get().refreshLaunch();
    const base = profileLaunch(profile, launch);
    const pane: Pane = { id: `t${Date.now().toString(36)}${paneSeq++}`, profile, nonce: 1, ...base, ...opts };
    set((s) => ({ panes: [...s.panes, pane] }));
    return pane.id;
  },

  async runCommand(title, command, cwd = "~") {
    const id = await get().addPane("shell", { title, initial: command, cwd });
    if (id) {
      set({ route: "terminals", focusPane: null });
    }
  },

  closePane(id) {
    call("pty_kill", { id });
    set((s) => ({ panes: s.panes.filter((p) => p.id !== id), focusPane: s.focusPane === id ? null : s.focusPane }));
  },

  restartPane(id) {
    set((s) => ({ panes: s.panes.map((p) => (p.id === id ? { ...p, nonce: p.nonce + 1, exited: false } : p)) }));
  },

  patchPane(id, patch) {
    set((s) => ({ panes: s.panes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  },

  setFocus(id) {
    set({ focusPane: id });
  },
}));

export const appName = (apps: AppDef[], id: string) => apps.find((a) => a.id === id)?.name ?? (id || "WorkStudio");
