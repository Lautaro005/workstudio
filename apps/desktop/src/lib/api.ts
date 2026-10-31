// Bridge to the Rust side. Outside Tauri (plain browser preview) a small mock answers instead,
// so the UI can be designed and checked without the desktop shell.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { mock } from "./mock";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) return mock.invoke(cmd, args) as Promise<T>;
  return tauriInvoke<T>(cmd, args);
}

export async function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return mock.listen(event, cb as (p: unknown) => void);
  return tauriListen<T>(event, (e) => cb(e.payload));
}

export type Cmds = { unix: string; windows: string };

export type AppDef = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  icon: string;
  repo: string;
  site: string;
  kind: "web" | "native" | "cli" | string;
  url: string;
  health?: { url: string; contains: string } | null;
  home: string;
  cli: string;
  mac_app: string;
  process: string;
  version?: { file: string; cmd: string; json_url: string; field: string } | null;
  start: Cmds;
  stop?: { url: string; header: string; value: string } | null;
  install: Cmds;
  update: Cmds;
  mcp?: { name: string; command: string; args: string[]; env: Record<string, string>; url: string; needs: string; description: string } | null;
  activity: string;
  features: string[];
  builtin: boolean;
  tagline_en?: string;
  description_en?: string;
  webstore?: string;
};

export type CliDef = {
  id: string;
  name: string;
  bin: string;
  version: string;
  install: Cmds;
  update: Cmds;
  mcp: "claude" | "codex" | "workspace" | "none" | string;
  app: string;
  npm: string;
  builtin: boolean;
};

export type AppStatus = { id: string; installed: boolean; running: boolean; version?: string | null; location?: string | null };
export type CliStatus = { id: string; installed: boolean; version?: string | null; path?: string | null };

export type McpServer = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  source: string;
  description: string;
  ready: boolean;
  problem: string;
};

export type McpClient = {
  id: string;
  name: string;
  path: string;
  detected: boolean;
  connected: string[];
  external: { name: string; summary: string }[];
};

export type LaunchInfo = { claude_config: string; workspace: string; codex_args: string[]; count: number; names: string[] };

export type Note = {
  id: number;
  ts: number;
  app: string;
  kind: "info" | "success" | "warning" | "update" | "activity" | string;
  title: string;
  body: string;
  read: boolean;
  action: string;
};

export type UpdateInfo = {
  id: string;
  kind: "app" | "cli";
  name: string;
  current?: string | null;
  latest?: string | null;
  available: boolean;
  url: string;
  notes: string;
  published: string;
  command: string;
  installed: boolean;
};

export type Settings = {
  user_name: string;
  theme: "system" | "light" | "dark" | string;
  system_notifications: boolean;
  notify_apps: Record<string, boolean>;
  auto_check_updates: boolean;
  update_interval_hours: number;
  autostart: string[];
  mcp_apps: Record<string, boolean>;
  opencue_agent: string;
  terminal_font_size: number;
  terminal_shell: string;
  close_to_tray: boolean;
  onboarded: boolean;
  language: "system" | "es" | "en" | string;
  open_in_app: string[];
  chat_model?: string;
  chat_tools?: string[];
  /** Model ids hidden from the chat picker. */
  chat_hidden_models?: string[];
  /** Models added by hand, e.g. { id: "claude:claude-opus-6", name: "Claude Opus 6" }. */
  chat_custom_models?: { id: string; name: string }[];
  [k: string]: unknown;
};

export type AppInfo = { version: string; os: string; arch: string; data_dir: string; workspace: string; shell: string };

export const isWindows = () => navigator.userAgent.includes("Windows");
export const here = (c: Cmds) => (isWindows() ? c.windows : c.unix);

export type ChatModel = { id: string; name: string; group: string; tools: boolean };
export type ChatMsg = { role: "user" | "assistant"; text: string; ts: number; model: string; tools: { name: string; ok: boolean }[]; error: boolean };
export type Chat = { id: string; title: string; created: number; updated: number; model: string; tools: string[]; messages: ChatMsg[] };
export type ChatSummary = { id: string; title: string; updated: number; model: string };
