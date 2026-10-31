// Browser-only stand-in for the Rust commands (used by `npm run dev` without Tauri).
import catalog from "../../../../catalog/apps.json";

type Cb = (p: unknown) => void;
const listeners = new Map<string, Set<Cb>>();
const emit = (ev: string, p: unknown) => listeners.get(ev)?.forEach((cb) => cb(p));
const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
const now = Date.now();

let settings = {
  user_name: "Lautaro",
  theme: "system",
  system_notifications: true,
  notify_apps: {},
  auto_check_updates: true,
  update_interval_hours: 6,
  autostart: ["brain"],
  mcp_apps: {},
  opencue_agent: "",
  terminal_font_size: 13,
  terminal_shell: "",
  close_to_tray: true,
  onboarded: true,
  language: "system",
  open_in_app: [] as string[],
  chat_model: "claude:sonnet",
  chat_tools: ["brain"],
};

type MockChat = { id: string; title: string; created: number; updated: number; model: string; tools: string[]; messages: any[] };
const chats: MockChat[] = [
  {
    id: "c1",
    title: "¿Qué hay en mi vault sobre WorkStudio?",
    created: now - 3600_000,
    updated: now - 3500_000,
    model: "claude:sonnet",
    tools: ["brain"],
    messages: [
      { role: "user", text: "¿Qué hay en mi vault sobre WorkStudio?", ts: now - 3600_000, model: "", tools: [], error: false },
      {
        role: "assistant",
        text: "Encontré **una nota de proyecto**: `projects/workstudio.md`.\n\n- Es una app de escritorio (Tauri 2 + React) que junta brain, Lumina y OpenCue.\n- Tiene terminales ×6 con MCP, avisos y actualizaciones.\n\n| Parte | Estado |\n|---|---|\n| App | Instalada |\n| GitHub | Sin publicar |",
        ts: now - 3500_000,
        model: "claude:sonnet",
        tools: [{ name: "brain__search_knowledge", ok: true }, { name: "brain__read_file", ok: true }],
        error: false,
      },
    ],
  },
];

let statuses = [
  { id: "brain", installed: true, running: true, version: "v0.03.3.4", location: "~/.brain" },
  { id: "opencue", installed: true, running: false, version: "0.5.2", location: "~/Applications/OpenCue.app" },
  { id: "lumina", installed: true, running: true, version: "0.1.6", location: "~/.lumina" },
];

let notes = [
  { id: 1, ts: now - 1000 * 60 * 2, app: "brain", kind: "activity", title: "brain: 3 cambios en el vault", body: "projects/workstudio.md · memory/2026-10-26.md · skills/notas.md", read: false, action: "app:brain" },
  { id: 2, ts: now - 1000 * 60 * 18, app: "lumina", kind: "activity", title: "Reunión terminada", body: "Lumina está escribiendo las notas y el resumen.", read: false, action: "app:lumina" },
  { id: 3, ts: now - 1000 * 60 * 60, app: "opencue", kind: "update", title: "OpenCue 0.5.3 disponible", body: "Tenés la 0.5.2. Actualizalo desde WorkStudio → Actualizaciones.", read: true, action: "updates" },
  { id: 4, ts: now - 1000 * 60 * 60 * 26, app: "", kind: "success", title: "MCP conectado", body: "claude-code: ya tiene las herramientas de tus apps.", read: true, action: "mcp" },
];

const servers = [
  { name: "brain", command: "/Users/you/.local/bin/uv", args: ["run", "--directory", "/Users/you/.brain", "python", "server.py"], env: {}, url: "", headers: {}, enabled: true, source: "app:brain", description: "Vault, memoria, búsqueda híbrida, skills, grafo, Fact check y web_search", ready: true, problem: "" },
  { name: "opencue", command: "/Users/you/.local/bin/opencue", args: ["mcp-serve", "--agent", ""], env: {}, url: "", headers: {}, enabled: true, source: "app:opencue", description: "Memoria, archivos, computadora y automatizaciones de un agente de OpenCue", ready: false, problem: "Elegí qué agente de OpenCue expone sus herramientas" },
  { name: "lumina", command: "/Users/you/.local/bin/lumina", args: ["mcp"], env: {}, url: "", headers: {}, enabled: true, source: "app:lumina", description: "Reuniones, transcripciones, notas y fuentes indexadas", ready: true, problem: "" },
  { name: "github", command: "", args: [], env: {}, url: "https://api.githubcopilot.com/mcp/", headers: {}, enabled: false, source: "import:claude-code", description: "", ready: true, problem: "" },
];

const updates = [
  { id: "brain", kind: "app", name: "brain", current: "v0.03.3.4", latest: "v0.03.3.4", available: false, url: "https://github.com/Lautaro005/brain/releases", notes: "", published: "2026-10-25T18:00:00Z", command: "brain update", installed: true },
  { id: "opencue", kind: "app", name: "OpenCue", current: "0.5.2", latest: "v0.5.3", available: true, url: "https://github.com/Lautaro005/opencue/releases", notes: "Plan como checklist, grupos de coding en la carpeta del grupo y arreglos de permisos.", published: "2026-10-26T15:00:00Z", command: "curl -fsSL https://lautaro005.github.io/opencue/install.sh | sh", installed: true },
  { id: "lumina", kind: "app", name: "Lumina", current: "0.1.6", latest: "v0.1.6", available: false, url: "https://github.com/Lautaro005/lumina/releases", notes: "", published: "2026-10-25T12:00:00Z", command: "lumina update", installed: true },
  { id: "claude", kind: "cli", name: "Claude Code", current: "2.4.1", latest: "2.4.3", available: true, url: "", notes: "", published: "", command: "claude update", installed: true },
  { id: "codex", kind: "cli", name: "Codex CLI", current: "0.61.0", latest: "0.61.0", available: false, url: "", notes: "", published: "", command: "npm install -g @openai/codex@latest", installed: true },
  { id: "gemini", kind: "cli", name: "Gemini CLI", current: null, latest: "0.14.0", available: false, url: "", notes: "", published: "", command: "npm install -g @google/gemini-cli@latest", installed: false },
];

const ptys = new Map<string, string>();

export const mock = {
  listen(ev: string, cb: Cb) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(cb);
    return Promise.resolve(() => listeners.get(ev)?.delete(cb));
  },
  async invoke(cmd: string, a: any = {}): Promise<unknown> {
    switch (cmd) {
      case "get_catalog":
        return { apps: catalog.apps.map((x) => ({ ...x, builtin: true })), clis: catalog.clis };
      case "get_statuses":
        return statuses;
      case "app_start":
        statuses = statuses.map((s) => (s.id === a.id ? { ...s, running: true } : s));
        emit("apps-status", statuses);
        return null;
      case "app_stop":
        statuses = statuses.map((s) => (s.id === a.id ? { ...s, running: false } : s));
        emit("apps-status", statuses);
        return null;
      case "pty_spawn": {
        ptys.set(a.opts.id, "");
        setTimeout(() => {
          emit("pty-data", { id: a.opts.id, data: enc("\x1b[38;2;202;138;4mWorkStudio\x1b[0m · vista previa del navegador\r\n") });
          if (a.opts.initial) emit("pty-data", { id: a.opts.id, data: enc(`\x1b[2m~/.workstudio/workspace\x1b[0m $ ${a.opts.initial}\r\n`) });
          emit("pty-data", { id: a.opts.id, data: enc("\x1b[38;2;194;65;12m❯\x1b[0m ") });
        }, 120);
        return null;
      }
      case "pty_write": {
        const d: string = a.data;
        const out = d === "\r" ? "\r\n\x1b[38;2;194;65;12m❯\x1b[0m " : d === "\x7f" ? "\b \b" : d;
        emit("pty-data", { id: a.id, data: enc(out) });
        return null;
      }
      case "clis_status":
        return [
          { id: "claude", installed: true, version: "2.4.1", path: "/Users/you/.local/bin/claude" },
          { id: "codex", installed: true, version: "0.61.0", path: "/opt/homebrew/bin/codex" },
          { id: "gemini", installed: false },
          { id: "cursor-agent", installed: false },
          { id: "brain-cli", installed: true, version: "v0.03.3.4" },
          { id: "lumina-cli", installed: true, version: "0.1.6" },
          { id: "opencue-cli", installed: true, version: "0.5.2" },
        ];
      case "mcp_list":
        return servers;
      case "mcp_hub_tools":
        return [
          { name: "brain__search_knowledge", description: "[brain] Búsqueda híbrida en el vault y las fuentes" },
          { name: "brain__add_memory", description: "[brain] Guarda un recuerdo duradero" },
          { name: "lumina__list_meetings", description: "[lumina] Reuniones grabadas" },
        ];
      case "chat_models":
        return [
          ...[["opus", "Opus · latest"], ["sonnet", "Sonnet · latest"], ["haiku", "Haiku · latest"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"], ["claude-fable-5-1", "Claude Fable 5.1"], ["claude-opus-4-8", "Claude Opus 4.8"]].map(([id, name]) => ({ id: `claude:${id}`, name, group: "Claude Code", tools: true })),
          ...[["", "Codex · default"], ["latest:gpt-6-luna", "GPT Luna · latest"], ["latest:gpt-5.6-terra", "GPT Terra · latest"], ["latest:gpt-6.1-sol", "GPT Sol · latest"], ["gpt-6.1-sol", "GPT-6.1-Sol"], ["gpt-6-luna", "GPT-6-Luna"], ["gpt-5.6-terra", "GPT-5.6-Terra"], ["gpt-5.3-codex", "GPT-5.3-Codex"]].map(([id, name]) => ({ id: `codex:${id}`, name, group: "Codex", tools: true })),
          { id: "ollama:qwen3:8b", name: "qwen3:8b", group: "Ollama", tools: true },
          { id: "opencue:pacman", name: "pacman", group: "OpenCue", tools: false },
        ];
      case "chat_list":
        return [...chats].sort((x, y) => y.updated - x.updated).map(({ id, title, updated, model }) => ({ id, title, updated, model }));
      case "chat_get":
        return chats.find((c) => c.id === a.id) ?? null;
      case "chat_delete": {
        const i = chats.findIndex((c) => c.id === a.id);
        if (i >= 0) chats.splice(i, 1);
        return null;
      }
      case "chat_stop":
        return null;
      case "chat_send": {
        let c = chats.find((x) => x.id === a.chat);
        if (!c) {
          c = { id: `c${Date.now()}`, title: a.text.slice(0, 60), created: Date.now(), updated: Date.now(), model: a.model, tools: a.tools, messages: [] };
          chats.push(c);
        }
        c.messages.push({ role: "user", text: a.text, ts: Date.now(), model: "", tools: [], error: false });
        const id = c.id;
        const answer = "Esto es la **vista previa del navegador**: en la app, la respuesta llega del modelo que elegiste, con " + (a.tools.length ? a.tools.join(", ") : "ninguna herramienta") + ".";
        const words = answer.split(" ");
        if (a.tools[0]) setTimeout(() => emit("chat-event", { chat: id, kind: "tool", text: `${a.tools[0]}__search` }), 200);
        words.forEach((w, i) => setTimeout(() => emit("chat-event", { chat: id, kind: "delta", text: (i ? " " : "") + w }), 500 + i * 60));
        setTimeout(() => {
          c!.messages.push({ role: "assistant", text: answer, ts: Date.now(), model: a.model, tools: a.tools[0] ? [{ name: `${a.tools[0]}__search`, ok: true }] : [], error: false });
          c!.updated = Date.now();
          emit("chat-event", { chat: id, kind: "done", text: answer });
        }, 600 + words.length * 60);
        return id;
      }
      case "mcp_clients":
        return [
          { id: "claude-code", name: "Claude Code", path: "~/.claude.json", detected: true, connected: ["workstudio"], external: [{ name: "vmpal", summary: "/Applications/VMPal.app/… --mcp" }] },
          { id: "claude-desktop", name: "Claude Desktop", path: "~/Library/Application Support/Claude/claude_desktop_config.json", detected: true, connected: [], external: [] },
          { id: "codex", name: "Codex", path: "~/.codex/config.toml", detected: true, connected: [], external: [{ name: "node_repl", summary: "node …" }, { name: "computer-use", summary: "…" }] },
          { id: "cursor", name: "Cursor", path: "~/.cursor/mcp.json", detected: false, connected: [], external: [] },
          { id: "gemini", name: "Gemini CLI", path: "~/.gemini/settings.json", detected: false, connected: [], external: [] },
          { id: "windsurf", name: "Windsurf", path: "~/.codeium/windsurf/mcp_config.json", detected: false, connected: [], external: [] },
        ];
      case "mcp_launch_info":
        return { claude_config: "/Users/you/.workstudio/mcp/claude.json", workspace: "/Users/you/.workstudio/workspace", codex_args: ["-c", 'mcp_servers.brain.command="uv"'], count: 2, names: ["brain", "lumina"] };
      case "mcp_preview":
        return { claude: JSON.stringify({ mcpServers: { workstudio: { type: "stdio", command: "/Applications/AI WorkStudio.app/Contents/MacOS/workstudio", args: ["mcp"] } } }, null, 2), codex: '[mcp_servers.workstudio]\ncommand = "/Applications/AI WorkStudio.app/Contents/MacOS/workstudio"\nargs = ["mcp"]\n', workspace: "/Users/you/.workstudio/workspace", members: ["brain", "lumina"] };
      case "opencue_agents":
        return [
          { id: "a1", name: "Codex" },
          { id: "a2", name: "pacman" },
          { id: "a3", name: "Investigadora" },
        ];
      case "notes_list":
        return notes;
      case "notes_mark_read":
        notes = notes.map((n) => (a.ids.length === 0 || a.ids.includes(n.id) ? { ...n, read: true } : n));
        emit("ws-notes-changed", null);
        return null;
      case "notes_clear":
        notes = [];
        emit("ws-notes-changed", null);
        return null;
      case "notify_test":
      case "notify_push": {
        const n = { id: Date.now(), ts: Date.now(), app: a.appId ?? "", kind: a.kind ?? "info", title: a.title ?? "Notificaciones activas", body: a.body ?? "Así se ven los avisos de AI WorkStudio.", read: false, action: a.action ?? "" };
        notes = [...notes, n];
        emit("ws-notification", n);
        return null;
      }
      case "updates_get":
      case "updates_check":
        return updates;
      case "settings_get":
        return settings;
      case "settings_set":
        settings = a.value;
        return null;
      case "app_info":
        return { version: "0.1.2", os: "macos", arch: "aarch64", data_dir: "~/.workstudio", workspace: "~/.workstudio/workspace", shell: "/bin/zsh" };
      default:
        return null;
    }
  },
};
