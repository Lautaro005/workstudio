<p align="center"><img src="assets/logo.svg" width="88" alt=""></p>

<h1 align="center">AI WorkStudio</h1>

<p align="center"><b>Your local AI apps in one studio.</b><br>
brain remembers, Lumina listens, OpenCue works — WorkStudio brings them together like a workspace:<br>
status, notifications, updates, shared MCP servers and up to six terminals at once. macOS, Windows and Linux.</p>

<p align="center"><a href="https://lautaro005.github.io/workstudio/">Website</a> · <a href="https://lautaro005.github.io/workstudio/docs.html">Docs</a> · <a href="https://github.com/Lautaro005/workstudio/releases">Releases</a> · <a href="CHANGELOG.md">Changelog</a></p>

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.sh | sh
```

With brain, Lumina and OpenCue too:

```bash
curl -fsSL https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.sh | sh -s -- --all
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.ps1 | iex
```

On macOS the app goes to `/Applications/AI WorkStudio.app` (or `~/Applications` with `--user`), on Linux to
`~/.local/opt/workstudio` with a menu entry, on Windows to your user's programs. All of them add a `workstudio`
command: `workstudio` opens it, `workstudio update` updates it, `workstudio uninstall` removes it (your settings in
`~/.workstudio` stay). No release yet for your platform? Add `--build` to build from source (needs git, Node and Rust).

## What it does

| | |
|---|---|
| **Workspace** | Home with every app's status and version; sidebar with live status; Google-style app launcher; ⌘K palette. Spanish and English. |
| **Apps inside** | Each app opens on its details; brain's dashboard and Lumina can also be used inside WorkStudio (with the preferences of their own window), or open there directly if you check it. OpenCue opens in its own window. |
| **Chat** | Talk to Claude Code, Codex, Gemini, any Ollama model or an OpenCue agent. Pills turn on brain, Lumina and web search (built into WorkStudio). Conversations stay in `~/.workstudio/chats`. |
| **Terminals** | Up to six real terminals in a grid. Profiles for Claude Code, Codex, Gemini CLI, Cursor Agent, brain, lumina and opencue. |
| **One MCP server** | `workstudio mcp` joins the tools of your apps (and the servers you add) under one server, named `<app>__<tool>`. Terminals and the chat get it automatically; connect Claude Code, Claude Desktop, Codex, Cursor, Gemini or Windsurf with one click (with a backup). |
| **Notifications** | brain vault changes, Lumina meetings, apps that start or stop, new versions — in the app and as system notifications. |
| **Updates** | Checks GitHub releases and npm every few hours; updates each app and CLI from a terminal; WorkStudio updates itself (signed bundles). |

### One MCP server

`workstudio mcp` is an MCP server that starts the servers of your apps, merges their tools and routes each call:
`brain__search_knowledge`, `lumina__…`, `opencue__…`. Agents see one server instead of a long list.
`workstudio mcp --only brain,lumina,web` limits it; `web` adds WorkStudio's own `web__search` and `web__fetch`.

WorkStudio writes it to `~/.workstudio/mcp/claude.json` and to a workspace folder (`~/.workstudio/workspace`) that
agent terminals start in:

- **Claude Code** → `claude --mcp-config ~/.workstudio/mcp/claude.json`
- **Codex** → `codex -c mcp_servers.workstudio.command=… -c mcp_servers.workstudio.args=[…]` (your `config.toml` is untouched)
- **Gemini CLI** → `.gemini/settings.json` in the workspace
- **Cursor Agent** → `.cursor/mcp.json` in the workspace; VS Code → `.vscode/mcp.json`

HTTP servers you add are passed next to it, as they are. The servers it carries:

| App | Server |
|---|---|
| brain | `uv run --directory ~/.brain python server.py` |
| Lumina | `lumina mcp` |
| OpenCue | `opencue mcp-serve --agent <id>` (pick the agent in MCP) |

### The chat

| Model | How it runs |
|---|---|
| Claude Code (Opus / Sonnet / Haiku *latest* and each version: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1, Opus 5 … Haiku 4.5) | `claude -p` headless with your login, only the `workstudio` server (`--strict-mcp-config`) and no built-in tools |
| Codex (default, a *latest* per family and every version: your account's models from `~/.codex/models_cache.json` first, then the GPT versions Codex knows) | `codex exec --json`, read-only sandbox, `workstudio` passed with `-c` |
| Gemini CLI | `gemini -p` in a folder whose `.gemini/settings.json` has only `workstudio` |
| Ollama | `/api/chat` from WorkStudio, which runs the tool calls itself |
| OpenCue agent | OpenCue's `send_to_agent`: the agent answers with its own tools (the pills don't apply) |

### Adding an app

New apps of the family go in [`catalog/apps.json`](catalog/apps.json) (shipped inside WorkStudio). For one of your
own, add an entry like this to the `apps` list of `~/.workstudio/apps.json`; it wins by `id`:

```json
{
  "id": "my-app",
  "name": "My App",
  "tagline": "What it does",
  "kind": "web",
  "url": "http://127.0.0.1:9000/",
  "health": { "url": "http://127.0.0.1:9000/api/health", "contains": "ok" },
  "cli": "my-app",
  "repo": "me/my-app",
  "start": { "unix": "my-app serve", "windows": "my-app serve" },
  "install": { "unix": "curl -fsSL https://example.com/install.sh | sh", "windows": "irm https://example.com/install.ps1 | iex" },
  "update": { "unix": "my-app update", "windows": "my-app update" },
  "mcp": { "command": "{cli}", "args": ["mcp"] }
}
```

Placeholders in MCP commands: `{cli}` (full path of the app's command), `{home}` (its `home` folder), `{uv}`, `{ws}`
(`~/.workstudio`).

## Data

Everything WorkStudio keeps is in `~/.workstudio` (`WORKSTUDIO_HOME` overrides it): `settings.json`, `apps.json`,
`mcp.json`, `notifications.json`, `mcp/` (generated configs), `workspace/` and `logs/`.

## Development

```bash
cd apps/desktop
npm install
npm run dev          # UI in the browser with a mock backend (http://localhost:1430)
npx tauri dev        # the desktop app
npx tauri build      # bundles (set TAURI_SIGNING_PRIVATE_KEY for updater artifacts)
```

Rust checks (what CI runs): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` in
`apps/desktop/src-tauri`.

Stack: Tauri 2 + Rust (portable-pty, ureq, toml_edit) and React 19 + TypeScript + zustand + xterm.js. Same family
pattern as [brain](https://github.com/Lautaro005/brain), [OpenCue](https://github.com/Lautaro005/opencue) and
[Lumina](https://github.com/Lautaro005/lumina).

## Releasing

Bump the version in `apps/desktop/package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, add a
`CHANGELOG.md` entry, then push a tag `vX.Y.Z`. The Release workflow builds macOS (universal), Linux and Windows
installers plus `latest.json` for the updater. It needs the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the key
whose public half is in `tauri.conf.json`).

## License

Apache-2.0 with the Commons Clause — free to use, modify and share, not to sell. See [LICENSE](LICENSE) and
[SECURITY.md](SECURITY.md).
