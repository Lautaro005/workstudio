# Security Policy

AI WorkStudio starts and stops local apps, runs real terminals, writes MCP configuration into other programs
(Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf), runs automations on a schedule, lets chat models read your notes vault and installs and updates itself, so security
reports are taken seriously and handled privately.

## Supported versions

| Version | Supported |
|---|---|
| Latest release (`0.1.x`) | ✅ |
| Older | ❌ — please update first (WorkStudio updates itself) |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for security problems.**

Report privately through GitHub: the repository's **Security** tab →
[**Report a vulnerability**](https://github.com/Lautaro005/workstudio/security/advisories/new).

Please include the version, your operating system, how you installed WorkStudio, steps to reproduce and the impact you
expect. Remove API keys and personal data from logs.

- Acknowledgement within **7 days**, an initial assessment within **14 days**
- A fix or mitigation plan for confirmed issues, coordinated with you before disclosure (90 days by default)
- Credit in the advisory and release notes, if you want it

## Security model

- **Embedded apps get no commands.** brain, Lumina, OpenBlocks and any web app you add are shown in child webviews that only load
  `http://127.0.0.1` / `http://localhost` URLs and have no access to WorkStudio's Tauri commands (capabilities apply to
  the `main` webview only).
- **Terminals are your shell.** A WorkStudio terminal runs with your user's permissions, exactly like Terminal.app.
  Commands typed by WorkStudio (agent profiles, install and update buttons) are shown in the terminal before they run.
- **MCP config writes are scoped and reversible.** Connecting a client only adds or replaces the servers WorkStudio
  manages; the first write keeps a `.bak-workstudio` copy of the original file. Disconnecting removes only those servers.
  Server definitions, including environment variables you add, live in `~/.workstudio/mcp.json` on your machine.
- **Automations run with the permissions you give them.** An automation is a saved chat prompt with a model, pills,
  skills and an optional working folder. It runs while WorkStudio is open and does what the same chat could do: the
  pills it has on (brain, Lumina, OpenBlocks, web), and, only if you set the folder to *Edits*, create or change
  files there. Folders are read-only by default. Review the prompt and the pills before turning one on, and prefer
  *Read* mode for unattended runs. They are stored in `~/.workstudio/automations.json` on your machine.
- **Your notes vault is an untrusted-input boundary.** With the OpenBlocks pill on, the model reads pages of your vault
  and can create and edit them (OpenBlocks keeps history and a trash, and shows each change with an Undo). The chat's
  system prompt tells the model to treat the content of pages, web results and files as data, never as instructions,
  but a page you pasted from the internet can still try to steer a model: don't run unattended automations with
  *Edits* and the web on over a vault you don't trust.
- **Skills are instructions the model follows.** WorkStudio lists the skills it finds in your tools' folders
  (`~/.claude`, `~/.codex`, `~/.gemini`, OpenCue, brain, your vault) and reads one only when you turn it on or the
  model opens it; it never runs a skill's files by itself. Only read-only `SKILL.md` files (or brain's flat `skills/*.md`)
  are read. Don't install skills you haven't read.
- **Network.** WorkStudio talks to your apps on 127.0.0.1, to `api.github.com` (latest releases) and to
  `registry.npmjs.org` (latest CLI versions). Nothing about you is sent anywhere.
- **Updates.** The in-app updater only installs bundles signed with the release key (minisign) from this repository's
  GitHub Releases. Installers are not yet code-signed by Apple or Microsoft.
- **Manifests.** Apps added by manifest can define commands that WorkStudio runs (start, install, update). Only import
  manifests you trust — the same as running a script from the internet.

## Scope

In scope: a web page or embedded app reaching WorkStudio's commands; MCP config writes touching servers WorkStudio did
not add, or losing the user's file; the installers or updater running anything other than the official release;
secrets from `~/.workstudio/mcp.json` leaking into logs, the UI of another app or the network; an automation running
with more permissions than its saved mode or pills (for example editing a folder set to read-only); the skills list
reading files outside the known skills folders.

Out of scope: what an app of the catalog does by itself (report it to that app's repository), and anything that
requires an attacker who already runs code as your user.
