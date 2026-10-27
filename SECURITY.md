# Security Policy

AI WorkStudio starts and stops local apps, runs real terminals, writes MCP configuration into other programs
(Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf) and installs and updates itself, so security
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

- **Embedded apps get no commands.** brain, Lumina and any web app you add are shown in child webviews that only load
  `http://127.0.0.1` / `http://localhost` URLs and have no access to WorkStudio's Tauri commands (capabilities apply to
  the `main` webview only).
- **Terminals are your shell.** A WorkStudio terminal runs with your user's permissions, exactly like Terminal.app.
  Commands typed by WorkStudio (agent profiles, install and update buttons) are shown in the terminal before they run.
- **MCP config writes are scoped and reversible.** Connecting a client only adds or replaces the servers WorkStudio
  manages; the first write keeps a `.bak-workstudio` copy of the original file. Disconnecting removes only those servers.
  Server definitions, including environment variables you add, live in `~/.workstudio/mcp.json` on your machine.
- **Network.** WorkStudio talks to your apps on 127.0.0.1, to `api.github.com` (latest releases) and to
  `registry.npmjs.org` (latest CLI versions). Nothing about you is sent anywhere.
- **Updates.** The in-app updater only installs bundles signed with the release key (minisign) from this repository's
  GitHub Releases. Installers are not yet code-signed by Apple or Microsoft.
- **Manifests.** Apps added by manifest can define commands that WorkStudio runs (start, install, update). Only import
  manifests you trust — the same as running a script from the internet.

## Scope

In scope: a web page or embedded app reaching WorkStudio's commands; MCP config writes touching servers WorkStudio did
not add, or losing the user's file; the installers or updater running anything other than the official release;
secrets from `~/.workstudio/mcp.json` leaking into logs, the UI of another app or the network.

Out of scope: what an app of the catalog does by itself (report it to that app's repository), and anything that
requires an attacker who already runs code as your user.
