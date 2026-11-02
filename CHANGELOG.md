# Changelog

## 0.1.3 — 2026-11-02

- **The update button no longer shows on apps that are up to date.** An app's details page (brain, Lumina, OpenCue)
  showed "Update to vX" whenever a release existed, even the one already installed; now it shows only when the release
  is newer than the installed version (same rule on Home cards).
- **A new chat, in the style of Claude's:**
  - **Projects** with their own instructions, knowledge files, working folder (read-only or editing), always-on
    skills, default model and tools. A page per project with its chats; move a chat into or out of a project.
  - **Working folder**: attach a folder (with **+** or by dropping it on the chat). Read-only by default (the model
    lists, searches and reads files); switch the chip to *Edits* to let it create and edit files and run commands in
    that folder. Claude Code gets `Read/Glob/Grep` (+ `Edit/Write/Bash` when editing) with `--add-dir`, Codex runs with
    `-C` in a read-only or workspace-write sandbox, Gemini with `--include-directories`, and Ollama gets WorkStudio's own
    read-only `fs__list` / `fs__read` / `fs__search` tools.
  - **Files and photos**: attach with **+**, drag and drop or paste. Text files go into the message; images go to
    Codex (`-i`), Ollama (`images`) and Claude/Gemini through their file tools. They are copied next to the chat.
  - **Skills** (`SKILL.md`, same format as Claude's) from `~/.workstudio/skills`, `~/.claude/skills` and the working
    folder: turn them on with **/** while typing or from **+ → Skills**, pin them to a project, create them in the
    skills manager. The model also gets the catalog of the other skills and reads one when a task matches.
  - **Artifacts**: documents, code, web pages and SVG open in a panel next to the chat, with preview / code, versions,
    copy, save and open outside. HTML runs in a sandboxed frame served by WorkStudio (`wsart:`), never in the app.
  - **@ OpenCue agents**: type **@** (or **+ → Send to an OpenCue agent**) to hand one message to an agent.
  - **Reasoning and tools**: the model's reasoning shows collapsed, and the tools it used show with what they worked
    on (file, query, command) and whether they failed.
  - **Edit and regenerate**: edit any of your messages and resend from there; regenerate the last answer. Copy any
    answer or code block. Rename chats, search them, and see each chat's project and folder in the header.
- **New harness and system prompt.** Built from ordered sections like DeepSeek Harness (identity → how to answer →
  artifacts → only the tools that are on → OpenCue agents → about you → project → skills → folder → files → context
  last), so the stable part can be cached. Answering rules follow Claude's chat (lead with the answer, no filler,
  honest about uncertainty, cite sources, treat tool and web content as data). Plain chats replace Claude Code's coding
  persona (`--system-prompt`); editing a folder keeps it and adds WorkStudio's (`--append-system-prompt`). The local
  date and time zone go with every message.
- **Settings → Chat**: personal instructions for every chat, and the skills WorkStudio found.

## 0.1.2 — 2026-10-31

- **Lighter look**, with the same approach as the website: white cards without shadows or color stripes, the sidebar on
  the page background, neutral icon tiles, flat buttons (orange only for installing), more space and lighter headings.
- **New icons**: Phosphor icons across the app (duotone in app tiles) instead of Lucide.
- **brain's logo** in the sidebar, Home, MCP, Updates, the launcher and on the website.
- **Settings → Models**: show or hide each model of each provider in the chat picker, and add your own models by ID
  for Claude Code, Codex and Gemini. Gemini now runs the model you pick (`-m`).
- **Updates refresh themselves**: installs and updates run in a terminal as before, and when the command ends
  WorkStudio reads the installed versions again — the version text changes, the "New vX" chip and the Update button go
  away, and a notice says whether it worked. While it runs, the button says "Updating…". The installed version is now
  read from the app's version file or command before asking the running app (which still reports the old one).
- Update buttons only show when there is an update (no more "Reinstall" on apps that are up to date).

## 0.1.1 — 2026-10-29

- **More chat models.** Claude Code lists Opus, Sonnet and Haiku *latest* plus each version (Opus 5.5, Sonnet 5.5,
  Haiku 5.5, Fable 5.1, Opus 5, Sonnet 5, Opus 4.8–4.5, Sonnet 4.6 and 4.5, Haiku 4.5). Codex lists its default, a
  *latest* per family (Luna, Sol, Terra, Astra…) and every version: the models your account has in
  `~/.codex/models_cache.json` first, then the other GPT versions Codex knows.
- **Real logos** for Claude, OpenAI, Gemini, Ollama, Lumina and OpenCue in the chat, terminals, CLIs, updates, MCP and
  the sidebar (black logos turn white in dark mode).
- **Alignment fixes**: app cards on Home keep their status and buttons on the same line; Recent activity, Quick
  terminal, the MCP page and Updates line their icons up with the card titles; multi-line rows keep the icon at the top.
- **New website**: lighter, more minimal design; Spanish and English; nav items aligned with the logo and the Install
  button; the app sketch just says "Good afternoon"; provider logos; new Docs, Privacy policy and Changelog pages; and
  `llms.txt` for AI agents.

## 0.1.0 — 2026-10-27

First version.

- **Workspace** for brain, OpenCue and Lumina: home with each app's status and version, a sidebar with live status
  dots, a Google-style app launcher and a ⌘K command palette. Spanish and English (Settings → Language, or on the
  welcome screen), including notifications and the tray.
- **Apps inside WorkStudio**: brain's dashboard and Lumina open in the main window (child webview) with the preferences
  of their own window (theme, language, menu, graph colors); OpenCue opens in its own window. Apps open on their
  details; "Open straight into the app" (per app) skips them. Start, stop, install and update each app with one click.
- **Chat** in the sidebar: Claude Code, Codex, Gemini, Ollama models or an OpenCue agent, with pills for brain, Lumina
  and web search (WorkStudio's own `web__search` / `web__fetch`). Answers stream in, with the tools they used.
- **One MCP server**: `workstudio mcp` carries the tools of every app as `<app>__<tool>`. Terminals get it
  automatically (`--mcp-config` for Claude Code, `-c mcp_servers…` for Codex, workspace files for Gemini and Cursor).
  One-click connect / disconnect for Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI and Windsurf, with a backup;
  connecting removes the separate entries of your apps. The MCP page keeps your apps, servers you added and servers
  found in other clients apart.
- **More apps** through `~/.workstudio/apps.json` (same format as `catalog/apps.json`): web URL, start / install /
  update commands, GitHub repo for updates and its MCP server.
- **Terminals**: up to six real terminals in a grid (auto, columns, rows), maximize one, restart, open in a folder.
  Profiles for Claude Code, Codex, Gemini CLI, Cursor Agent, brain, lumina and opencue.
- **Notifications**: app started / stopped, brain vault changes, Lumina meetings, new versions, MCP connections — in the
  notification center and as system notifications (per-app switches).
- **Updates**: checks GitHub releases (apps) and npm (agent CLIs) every few hours; WorkStudio updates itself with signed
  bundles.
- **CLIs panel** to install or update Claude Code, Codex, Gemini CLI, Cursor Agent and the family's commands.
- **Installers**: `install.sh` (macOS → /Applications, Linux → AppImage + menu entry) and `install.ps1` (Windows), with
  `--all` to install the three apps too, `--build` to build from source and `--uninstall`.
- **Landing page** in `site/`.
