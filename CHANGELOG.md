# Changelog

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
