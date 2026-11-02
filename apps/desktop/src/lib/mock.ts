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

type MockChat = { id: string; title: string; created: number; updated: number; model: string; tools: string[]; messages: any[]; project?: string; folder?: string; mode?: string; skills?: string[] };
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

const projects: any[] = [
  { id: "p1", name: "Tesis", description: "Mi tesis sobre derecho penal", instructions: "Respondé con citas de doctrina y jurisprudencia argentina.", folder: "~/Documentos/Tesis", mode: "read", model: "", tools: ["brain", "web"], skills: [], files: [{ name: "indice.md", path: "~/.workstudio/projects/p1/files/indice.md", size: 3200 }], created: Date.now() - 864e5 * 3, updated: Date.now() - 36e5 },
];
const skills = [
  { name: "resumen-reunion", description: "Resume reuniones en decisiones, pendientes y responsables", source: "workstudio", path: "~/.workstudio/skills/resumen-reunion/SKILL.md" },
  { name: "pdf", description: "Leer, completar y armar PDFs", source: "claude", path: "~/.claude/skills/pdf/SKILL.md" },
];

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
        return [...chats].sort((x, y) => y.updated - x.updated).map(({ id, title, updated, model, project }) => ({ id, title, updated, model, project }));
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
        const o = a.opts;
        let c: MockChat | undefined = chats.find((x) => x.id === o.chat);
        if (!c) {
          c = { id: `c${Date.now()}`, title: (o.text || o.files?.[0]?.name || "").slice(0, 60), created: Date.now(), updated: Date.now(), model: o.model, tools: o.tools, messages: [], project: o.project, folder: o.folder, mode: o.mode, skills: o.skills };
          chats.push(c);
        }
        if (o.truncate != null) c.messages = c.messages.slice(0, o.truncate);
        c.folder = o.folder;
        c.mode = o.mode;
        c.skills = o.skills;
        c.messages.push({ role: "user", text: o.text, ts: Date.now(), model: "", tools: [], error: false, files: o.files, agent: o.agent, skills: (o.skills ?? []).map((p: string) => p.split("/").slice(-2, -1)[0]) });
        const id = c.id;
        const wantsPage = /pomodoro|página|pagina|html|page/i.test(o.text);
        const answer = o.agent
          ? `Listo, me ocupo desde OpenCue. (vista previa: respondería **${o.agent}**)`
          : wantsPage
            ? 'Te armé un pomodoro simple: 25 minutos de foco y 5 de descanso.\n\n<artifact id="pomodoro" type="html" title="Pomodoro">\n<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#faf8f4"><div style="text-align:center"><h1 id="t" style="font-size:64px;margin:0">25:00</h1><button onclick="go()" style="font-size:18px;padding:8px 18px;border-radius:10px;border:0;background:#c2410c;color:#fff">Empezar</button></div><script>let s=1500,i;function go(){clearInterval(i);i=setInterval(()=>{s--;t.textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},1000)}</script></body></html>\n</artifact>\n\nTocá **Empezar** para arrancar.'
            : "Esto es la **vista previa del navegador**: en la app, la respuesta llega del modelo que elegiste, con " + (o.tools.length ? o.tools.join(", ") : "ninguna herramienta") + (o.files?.length ? ` y ${o.files.length} archivo(s)` : "") + (o.folder ? ` en \`${o.folder}\`` : "") + ".\n\n```python\nprint('hola')\n```";
        const chunks = answer.match(/[\s\S]{1,24}/g) ?? [];
        const tool = o.agent ? `OpenCue → ${o.agent}` : o.tools[0] ? `${o.tools[0]}__search_knowledge` : "";
        setTimeout(() => emit("chat-event", { chat: id, kind: "thinking", text: "El usuario quiere algo concreto. Reviso qué herramientas tengo y armo la respuesta." }), 120);
        if (tool) {
          setTimeout(() => emit("chat-event", { chat: id, kind: "tool", text: tool }), 250);
          setTimeout(() => emit("chat-event", { chat: id, kind: "tool_detail", text: JSON.stringify({ i: 0, detail: o.text.slice(0, 40) }) }), 300);
          setTimeout(() => emit("chat-event", { chat: id, kind: "tool_done", text: JSON.stringify({ i: 0, ok: true }) }), 450);
        }
        chunks.forEach((w, i) => setTimeout(() => emit("chat-event", { chat: id, kind: "delta", text: w }), 500 + i * 25));
        setTimeout(() => {
          c!.messages.push({ role: "assistant", text: answer, ts: Date.now(), model: o.agent ? `opencue:${o.agent}` : o.model, tools: tool ? [{ name: tool, ok: true, detail: o.text.slice(0, 40) }] : [], error: false, thinking: "El usuario quiere algo concreto. Reviso qué herramientas tengo y armo la respuesta.", agent: o.agent });
          c!.updated = Date.now();
          emit("chat-event", { chat: id, kind: "done", text: answer });
        }, 600 + chunks.length * 25);
        return id;
      }
      case "chat_update": {
        const c = chats.find((x) => x.id === a.id);
        if (c && a.title) c.title = a.title;
        if (c && a.project != null) c.project = a.project;
        return c;
      }
      case "files_inspect":
        return (a.paths as string[]).filter((p) => p.includes(".")).map((p) => ({ name: p.split("/").pop(), path: p, kind: /\.(png|jpe?g)$/.test(p) ? "image" : "text", size: 1200 }));
      case "files_preview":
        return "";
      case "files_save_blob":
        return { name: a.name, path: `/tmp/${a.name}`, kind: "image", size: 1000 };
      case "project_list":
        return [...projects].sort((x, y) => y.updated - x.updated);
      case "project_save": {
        const p = { ...a.project };
        if (!p.id) {
          p.id = `p${Date.now()}`;
          p.created = Date.now();
          projects.push(p);
        } else {
          const i = projects.findIndex((x) => x.id === p.id);
          p.files = projects[i]?.files ?? [];
          projects[i] = p;
        }
        p.updated = Date.now();
        return p;
      }
      case "project_delete": {
        const i = projects.findIndex((x) => x.id === a.id);
        if (i >= 0) projects.splice(i, 1);
        chats.forEach((c) => c.project === a.id && (c.project = ""));
        return null;
      }
      case "project_add_files":
      case "project_remove_file":
        return projects.find((x) => x.id === a.id);
      case "skills_list":
        return skills;
      case "skill_read":
        return "# Pasos\n1. Leé la transcripción.\n2. Sacá decisiones, pendientes y responsables.";
      case "skill_save":
        skills.push({ name: a.name, description: a.description, source: "workstudio", path: `~/.workstudio/skills/${a.name}/SKILL.md` });
        return skills[skills.length - 1];
      case "skill_delete":
        return null;
      case "skills_folder":
        return "~/.workstudio/skills";
      case "artifact_put":
        return "k";
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
        return { version: "0.1.3", os: "macos", arch: "aarch64", data_dir: "~/.workstudio", workspace: "~/.workstudio/workspace", shell: "/bin/zsh" };
      default:
        return null;
    }
  },
};
