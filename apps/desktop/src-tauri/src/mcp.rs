//! One list of MCP servers for everything: the servers of the installed apps (brain, Lumina,
//! OpenCue…) plus the ones the user adds or imports. From that list WorkStudio writes the config every
//! agent CLI understands, so terminals get the tools automatically, and can connect agent clients
//! (Claude Code, Claude Desktop, Cursor, Codex, Gemini, Windsurf) with one click.

use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Server {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub enabled: bool,
    /// "app:<id>", "user" or "import:<client>"
    pub source: String,
    pub description: String,
    #[serde(skip_deserializing)]
    pub ready: bool,
    #[serde(skip_deserializing)]
    pub problem: String,
}

impl Server {
    pub fn is_http(&self) -> bool {
        !self.url.is_empty()
    }
    pub fn active(&self) -> bool {
        self.enabled && self.ready
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct UserFile {
    servers: Vec<Server>,
}

fn user_path() -> PathBuf {
    paths::ws_file("mcp.json")
}

fn read_user() -> UserFile {
    std::fs::read_to_string(user_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_user(f: &UserFile) -> anyhow::Result<()> {
    paths::write_atomic(&user_path(), &serde_json::to_string_pretty(f)?)?;
    Ok(())
}

pub fn clean_name(s: &str) -> String {
    let n: String = s
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    n.trim_matches('-').to_string()
}

fn which_or(bin: &str) -> String {
    which::which(bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| bin.to_string())
}

/// Servers that come from the apps of the catalog (only installed ones).
fn app_servers() -> Vec<Server> {
    let settings = crate::settings::load();
    let mut out = Vec::new();
    for app in crate::catalog::apps() {
        let Some(def) = app.mcp.clone() else { continue };
        let st = crate::apps::status(&app, false);
        if !st.installed {
            continue;
        }
        let home = paths::expand(&app.home);
        let sub = |s: &str| -> String {
            s.replace("{uv}", &which_or("uv"))
                .replace("{home}", &home)
                .replace("{cli}", &which_or(&app.cli))
                .replace("{opencue_agent}", &settings.opencue_agent)
                .replace("{ws}", &paths::ws_dir().to_string_lossy())
        };
        let mut s = Server {
            name: clean_name(if def.name.is_empty() {
                &app.id
            } else {
                &def.name
            }),
            command: sub(&def.command),
            args: def.args.iter().map(|a| sub(a)).collect(),
            env: def.env.iter().map(|(k, v)| (k.clone(), sub(v))).collect(),
            url: sub(&def.url),
            headers: BTreeMap::new(),
            enabled: settings.app_in_mcp(&app.id),
            source: format!("app:{}", app.id),
            description: if crate::settings::english() && !def.description_en.is_empty() {
                def.description_en.clone()
            } else {
                def.description.clone()
            },
            ready: true,
            problem: String::new(),
        };
        if def.needs == "opencue_agent" && settings.opencue_agent.is_empty() {
            s.ready = false;
            s.problem = crate::settings::tr(
                "Elegí qué agente de OpenCue expone sus herramientas",
                "Choose which OpenCue agent exposes its tools",
            )
            .into();
        }
        if !s.is_http() && s.command.is_empty() {
            s.ready = false;
            s.problem = crate::settings::tr("Falta el comando", "The command is missing").into();
        }
        out.push(s);
    }
    out
}

pub fn servers() -> Vec<Server> {
    let mut all = app_servers();
    for mut s in read_user().servers {
        s.ready = s.is_http() || !s.command.is_empty();
        if !s.ready {
            s.problem =
                crate::settings::tr("Falta el comando o la URL", "The command or URL is missing")
                    .into();
        }
        all.retain(|a| a.name != s.name);
        all.push(s);
    }
    all
}

pub fn active() -> Vec<Server> {
    servers().into_iter().filter(|s| s.active()).collect()
}

pub const HUB: &str = "workstudio";

/// WorkStudio itself as one MCP server (`workstudio mcp`) that carries the tools of every active
/// local server. `only` limits it (chat pills), e.g. ["brain", "web"].
pub fn hub_server(only: Option<&[String]>) -> Server {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "workstudio".into());
    let mut args = vec!["mcp".to_string()];
    if let Some(o) = only {
        args.push("--only".into());
        args.push(o.join(","));
    }
    Server {
        name: HUB.into(),
        command: exe,
        args,
        enabled: true,
        source: "workstudio".into(),
        description: crate::settings::tr(
            "brain, Lumina, OpenCue y tus servidores, en uno",
            "brain, Lumina, OpenCue and your servers, in one",
        )
        .into(),
        ready: true,
        ..Default::default()
    }
}

/// What the agents get: the hub (when there is a local server to carry) plus HTTP servers, which
/// the hub does not proxy.
pub fn published() -> Vec<Server> {
    let list = active();
    let mut out = Vec::new();
    if list.iter().any(|s| !s.is_http()) {
        out.push(hub_server(None));
    }
    out.extend(list.into_iter().filter(|s| s.is_http()));
    out
}

pub fn save_user_server(mut s: Server) -> anyhow::Result<()> {
    s.name = clean_name(&s.name);
    anyhow::ensure!(!s.name.is_empty(), "El servidor necesita un nombre");
    anyhow::ensure!(
        !s.command.is_empty() || !s.url.is_empty(),
        "Poné un comando o una URL"
    );
    if s.source.is_empty() || s.source.starts_with("app:") {
        s.source = "user".into();
    }
    let mut f = read_user();
    f.servers.retain(|x| x.name != s.name);
    f.servers.push(s);
    write_user(&f)?;
    write_generated()
}

pub fn remove_user_server(name: &str) -> anyhow::Result<()> {
    let mut f = read_user();
    f.servers.retain(|x| x.name != name);
    write_user(&f)?;
    write_generated()
}

pub fn set_enabled(name: &str, enabled: bool) -> anyhow::Result<()> {
    if let Some(app) = servers()
        .into_iter()
        .find(|s| s.name == name)
        .and_then(|s| s.source.strip_prefix("app:").map(String::from))
    {
        let mut st = crate::settings::load();
        st.mcp_apps.insert(app, enabled);
        crate::settings::save(&st)?;
    } else {
        let mut f = read_user();
        if let Some(s) = f.servers.iter_mut().find(|s| s.name == name) {
            s.enabled = enabled;
        }
        write_user(&f)?;
    }
    write_generated()
}

// ---------- formats ----------

#[derive(Clone, Copy, PartialEq)]
enum Style {
    Claude,
    ClaudeDesktop,
    Cursor,
    Gemini,
    Windsurf,
}

fn json_entry(s: &Server, style: Style) -> Option<Value> {
    if s.is_http() {
        let headers: Map<String, Value> = s
            .headers
            .iter()
            .map(|(k, v)| (k.clone(), json!(v)))
            .collect();
        return match style {
            Style::Claude => Some(json!({"type": "http", "url": s.url, "headers": headers})),
            Style::Cursor => Some(json!({"url": s.url, "headers": headers})),
            Style::Gemini => Some(json!({"httpUrl": s.url, "headers": headers})),
            Style::Windsurf => Some(json!({"serverUrl": s.url, "headers": headers})),
            Style::ClaudeDesktop => None,
        };
    }
    let mut v = json!({"command": s.command, "args": s.args});
    if style == Style::Claude {
        v["type"] = json!("stdio");
    }
    if !s.env.is_empty() {
        v["env"] = json!(s.env);
    }
    Some(v)
}

fn servers_object(list: &[Server], style: Style) -> Map<String, Value> {
    list.iter()
        .filter_map(|s| json_entry(s, style).map(|e| (s.name.clone(), e)))
        .collect()
}

pub fn claude_config_path() -> PathBuf {
    paths::ws_dir().join("mcp").join("claude.json")
}

fn toml_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// `-c` overrides that hand the servers to `codex` without touching `~/.codex/config.toml`.
pub fn codex_flags(list: &[Server]) -> Vec<String> {
    let mut out = Vec::new();
    for s in list {
        let key = format!("mcp_servers.{}", s.name);
        if s.is_http() {
            out.push(format!("{key}.url={}", toml_str(&s.url)));
            continue;
        }
        out.push(format!("{key}.command={}", toml_str(&s.command)));
        let args: Vec<String> = s.args.iter().map(|a| toml_str(a)).collect();
        out.push(format!("{key}.args=[{}]", args.join(",")));
        for (k, v) in &s.env {
            out.push(format!("{key}.env.{k}={}", toml_str(v)));
        }
    }
    out
}

/// Writes every generated file. Called at startup and whenever the list changes.
pub fn write_generated() -> anyhow::Result<()> {
    let members = active();
    let list = published();
    let claude = json!({"mcpServers": servers_object(&list, Style::Claude)});
    let text = serde_json::to_string_pretty(&claude)?;
    paths::write_atomic(&claude_config_path(), &text)?;

    let ws = paths::workspace_dir();
    paths::write_atomic(&ws.join(".mcp.json"), &text)?;
    paths::write_atomic(
        &ws.join(".cursor").join("mcp.json"),
        &serde_json::to_string_pretty(
            &json!({"mcpServers": servers_object(&list, Style::Cursor)}),
        )?,
    )?;
    paths::write_atomic(
        &ws.join(".gemini").join("settings.json"),
        &serde_json::to_string_pretty(
            &json!({"mcpServers": servers_object(&list, Style::Gemini)}),
        )?,
    )?;
    let vscode: Map<String, Value> = list
        .iter()
        .map(|s| {
            let v = if s.is_http() {
                json!({"type": "http", "url": s.url, "headers": s.headers})
            } else {
                json!({"type": "stdio", "command": s.command, "args": s.args, "env": s.env})
            };
            (s.name.clone(), v)
        })
        .collect();
    paths::write_atomic(
        &ws.join(".vscode").join("mcp.json"),
        &serde_json::to_string_pretty(&json!({"servers": vscode}))?,
    )?;

    let mut toml = String::from(
        "# Generated by AI WorkStudio. Copy into ~/.codex/config.toml or use MCP → Connect.\n",
    );
    for s in &list {
        toml.push_str(&format!("\n[mcp_servers.{}]\n", s.name));
        if s.is_http() {
            toml.push_str(&format!("url = {}\n", toml_str(&s.url)));
        } else {
            toml.push_str(&format!("command = {}\n", toml_str(&s.command)));
            let args: Vec<String> = s.args.iter().map(|a| toml_str(a)).collect();
            toml.push_str(&format!("args = [{}]\n", args.join(", ")));
            if !s.env.is_empty() {
                toml.push_str(&format!("[mcp_servers.{}.env]\n", s.name));
                for (k, v) in &s.env {
                    toml.push_str(&format!("{k} = {}\n", toml_str(v)));
                }
            }
        }
    }
    paths::write_atomic(&paths::ws_dir().join("mcp").join("codex.toml"), &toml)?;

    let mut agents = String::from(
        "# AI WorkStudio workspace\n\nThis folder is where WorkStudio terminals start. The MCP servers below are already configured for Claude Code (.mcp.json), Cursor (.cursor/mcp.json), Gemini CLI (.gemini/settings.json), VS Code (.vscode/mcp.json) and Codex (passed with -c).\n\n",
    );
    agents.push_str("All of them come through one server, `workstudio`. Its tools are named `<app>__<tool>`:\n\n");
    for s in &members {
        agents.push_str(&format!(
            "- **{}**: {}\n",
            s.name,
            if s.description.is_empty() {
                "MCP server"
            } else {
                &s.description
            }
        ));
    }
    agents.push_str("\nUse brain to remember and search what the user knows, Lumina for meetings and notes, OpenCue for the user's agents.\n");
    paths::write_atomic(&ws.join("AGENTS.md"), &agents)?;
    paths::write_atomic(&ws.join("CLAUDE.md"), &agents)?;
    paths::write_atomic(&ws.join("GEMINI.md"), &agents)?;
    Ok(())
}

#[derive(Serialize)]
pub struct LaunchInfo {
    pub claude_config: String,
    pub workspace: String,
    pub codex_args: Vec<String>,
    pub count: usize,
    pub names: Vec<String>,
}

pub fn launch_info() -> LaunchInfo {
    let members = active();
    let list = published();
    let mut codex_args = Vec::new();
    for f in codex_flags(&list) {
        codex_args.push("-c".to_string());
        codex_args.push(f);
    }
    LaunchInfo {
        claude_config: claude_config_path().to_string_lossy().into_owned(),
        workspace: paths::workspace_dir().to_string_lossy().into_owned(),
        codex_args,
        count: members.len(),
        names: members.iter().map(|s| s.name.clone()).collect(),
    }
}

// ---------- agent clients ----------

struct ClientDef {
    id: &'static str,
    name: &'static str,
    path: PathBuf,
    toml: bool,
    style: Style,
}

fn client_defs() -> Vec<ClientDef> {
    let h = paths::home();
    #[cfg(target_os = "macos")]
    let desktop = h.join("Library/Application Support/Claude/claude_desktop_config.json");
    #[cfg(target_os = "windows")]
    let desktop = dirs::config_dir()
        .unwrap_or(h.clone())
        .join("Claude")
        .join("claude_desktop_config.json");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let desktop = h.join(".config/Claude/claude_desktop_config.json");
    vec![
        ClientDef {
            id: "claude-code",
            name: "Claude Code",
            path: h.join(".claude.json"),
            toml: false,
            style: Style::Claude,
        },
        ClientDef {
            id: "claude-desktop",
            name: "Claude Desktop",
            path: desktop,
            toml: false,
            style: Style::ClaudeDesktop,
        },
        ClientDef {
            id: "codex",
            name: "Codex",
            path: h.join(".codex/config.toml"),
            toml: true,
            style: Style::Claude,
        },
        ClientDef {
            id: "cursor",
            name: "Cursor",
            path: h.join(".cursor/mcp.json"),
            toml: false,
            style: Style::Cursor,
        },
        ClientDef {
            id: "gemini",
            name: "Gemini CLI",
            path: h.join(".gemini/settings.json"),
            toml: false,
            style: Style::Gemini,
        },
        ClientDef {
            id: "windsurf",
            name: "Windsurf",
            path: h.join(".codeium/windsurf/mcp_config.json"),
            toml: false,
            style: Style::Windsurf,
        },
    ]
}

#[derive(Serialize)]
pub struct ClientStatus {
    pub id: String,
    pub name: String,
    pub path: String,
    pub detected: bool,
    /// Names of our servers present in its config.
    pub connected: Vec<String>,
    /// Servers in its config that WorkStudio does not have (can be imported).
    pub external: Vec<ExternalServer>,
}

#[derive(Serialize, Clone)]
pub struct ExternalServer {
    pub name: String,
    pub summary: String,
}

fn read_json(path: &PathBuf) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}))
}

fn read_toml(path: &PathBuf) -> toml_edit::DocumentMut {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_default()
}

/// Every server a client has, as WorkStudio servers.
fn client_servers(c: &ClientDef) -> Vec<Server> {
    let mut out = Vec::new();
    if c.toml {
        let doc = read_toml(&c.path);
        if let Some(tbl) = doc.get("mcp_servers").and_then(|t| t.as_table_like()) {
            for (name, item) in tbl.iter() {
                let Some(t) = item.as_table_like() else {
                    continue;
                };
                let get_s = |k: &str| t.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let args = t
                    .get("args")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let env = t
                    .get("env")
                    .and_then(|v| v.as_table_like())
                    .map(|e| {
                        e.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.to_string(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();
                out.push(Server {
                    name: name.to_string(),
                    command: get_s("command"),
                    args,
                    env,
                    url: get_s("url"),
                    ..Default::default()
                });
            }
        }
    } else {
        let v = read_json(&c.path);
        if let Some(obj) = v.get("mcpServers").and_then(|m| m.as_object()) {
            for (name, e) in obj {
                let s = |k: &str| e.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                let url = [s("url"), s("httpUrl"), s("serverUrl")]
                    .into_iter()
                    .find(|u| !u.is_empty())
                    .unwrap_or_default();
                let map = |k: &str| -> BTreeMap<String, String> {
                    e.get(k)
                        .and_then(|x| x.as_object())
                        .map(|o| {
                            o.iter()
                                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                                .collect()
                        })
                        .unwrap_or_default()
                };
                let args = e
                    .get("args")
                    .and_then(|a| a.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                out.push(Server {
                    name: name.clone(),
                    command: s("command"),
                    args,
                    env: map("env"),
                    url,
                    headers: map("headers"),
                    ..Default::default()
                });
            }
        }
    }
    out
}

fn summary(s: &Server) -> String {
    if s.is_http() {
        s.url.clone()
    } else {
        let mut t = s.command.clone();
        for a in &s.args {
            t.push(' ');
            t.push_str(a);
        }
        t
    }
}

pub fn clients() -> Vec<ClientStatus> {
    let mut ours: Vec<String> = servers().into_iter().map(|s| s.name).collect();
    ours.push(HUB.into());
    let active: Vec<String> = published().into_iter().map(|s| s.name).collect();
    client_defs()
        .into_iter()
        .map(|c| {
            let theirs = client_servers(&c);
            let detected = c.path.exists() || c.path.parent().map(|p| p.exists()).unwrap_or(false);
            ClientStatus {
                id: c.id.into(),
                name: c.name.into(),
                path: c.path.to_string_lossy().into_owned(),
                detected,
                connected: theirs
                    .iter()
                    .filter(|s| active.contains(&s.name))
                    .map(|s| s.name.clone())
                    .collect(),
                external: theirs
                    .iter()
                    .filter(|s| !ours.contains(&s.name))
                    .map(|s| ExternalServer {
                        name: s.name.clone(),
                        summary: summary(s),
                    })
                    .collect(),
            }
        })
        .collect()
}

fn backup_once(path: &PathBuf) {
    if path.exists() {
        let bak = PathBuf::from(format!("{}.bak-workstudio", path.to_string_lossy()));
        if !bak.exists() {
            let _ = std::fs::copy(path, bak);
        }
    }
}

/// Adds (connect) or removes (disconnect) WorkStudio's active servers from a client's own config.
pub fn set_client(id: &str, connect: bool) -> anyhow::Result<()> {
    let c = client_defs()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| anyhow::anyhow!("cliente desconocido"))?;
    let list = published();
    // The hub already carries the local servers: their own entries would show each tool twice.
    let carried: Vec<String> = active()
        .into_iter()
        .filter(|s| !s.is_http())
        .map(|s| s.name)
        .collect();
    let mut all_names: Vec<String> = servers().into_iter().map(|s| s.name).collect();
    all_names.push(HUB.into());
    backup_once(&c.path);
    if c.toml {
        let mut doc = read_toml(&c.path);
        if doc.get("mcp_servers").is_none() {
            let mut t = toml_edit::Table::new();
            t.set_implicit(true);
            doc["mcp_servers"] = toml_edit::Item::Table(t);
        }
        let tbl = doc["mcp_servers"]
            .as_table_mut()
            .ok_or_else(|| anyhow::anyhow!("mcp_servers no es una tabla"))?;
        if connect {
            for n in &carried {
                tbl.remove(n);
            }
            for s in &list {
                let mut t = toml_edit::Table::new();
                if s.is_http() {
                    t["url"] = toml_edit::value(s.url.clone());
                } else {
                    t["command"] = toml_edit::value(s.command.clone());
                    let mut arr = toml_edit::Array::new();
                    for a in &s.args {
                        arr.push(a.as_str());
                    }
                    t["args"] = toml_edit::value(arr);
                    if !s.env.is_empty() {
                        let mut e = toml_edit::Table::new();
                        for (k, v) in &s.env {
                            e[k.as_str()] = toml_edit::value(v.clone());
                        }
                        t["env"] = toml_edit::Item::Table(e);
                    }
                }
                tbl[s.name.as_str()] = toml_edit::Item::Table(t);
            }
        } else {
            for n in &all_names {
                tbl.remove(n);
            }
        }
        paths::write_atomic(&c.path, &doc.to_string())?;
    } else {
        let mut v = read_json(&c.path);
        if !v.is_object() {
            v = json!({});
        }
        if !v.get("mcpServers").map(|m| m.is_object()).unwrap_or(false) {
            v["mcpServers"] = json!({});
        }
        let obj = v["mcpServers"].as_object_mut().unwrap();
        if connect {
            for n in &carried {
                obj.remove(n);
            }
            for (k, e) in servers_object(&list, c.style) {
                obj.insert(k, e);
            }
        } else {
            for n in &all_names {
                obj.remove(n);
            }
        }
        paths::write_atomic(&c.path, &serde_json::to_string_pretty(&v)?)?;
    }
    Ok(())
}

pub fn import(client_id: &str, name: &str) -> anyhow::Result<()> {
    let c = client_defs()
        .into_iter()
        .find(|c| c.id == client_id)
        .ok_or_else(|| anyhow::anyhow!("cliente desconocido"))?;
    let mut s = client_servers(&c)
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| anyhow::anyhow!("no encontré {name}"))?;
    s.enabled = true;
    s.source = format!("import:{client_id}");
    save_user_server(s)
}

// ---------- OpenCue agents ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenCueAgent {
    pub id: String,
    pub name: String,
}

fn opencue_db() -> PathBuf {
    if let Ok(h) = std::env::var("OPENCUE_HOME") {
        return PathBuf::from(h).join("opencue.db");
    }
    #[cfg(target_os = "macos")]
    return paths::home().join("Library/Application Support/opencue/opencue.db");
    #[cfg(target_os = "windows")]
    return dirs::config_dir()
        .unwrap_or_default()
        .join("opencue")
        .join("data")
        .join("opencue.db");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    return dirs::data_dir()
        .unwrap_or_default()
        .join("opencue")
        .join("opencue.db");
}

pub fn opencue_agents() -> Vec<OpenCueAgent> {
    let db = opencue_db();
    if !db.exists() || !crate::shellenv::has("sqlite3") {
        return Vec::new();
    }
    let out = std::process::Command::new("sqlite3")
        .args([
            "-readonly",
            "-json",
            &db.to_string_lossy(),
            "SELECT id, name FROM agents ORDER BY name",
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => serde_json::from_slice(&o.stdout).unwrap_or_default(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_flags_are_toml() {
        let s = Server {
            name: "brain".into(),
            command: "/usr/bin/uv".into(),
            args: vec!["run".into(), "a \"b\"".into()],
            ..Default::default()
        };
        let f = codex_flags(&[s]);
        assert_eq!(f[0], "mcp_servers.brain.command=\"/usr/bin/uv\"");
        assert_eq!(f[1], "mcp_servers.brain.args=[\"run\",\"a \\\"b\\\"\"]");
    }

    #[test]
    fn http_entries_follow_each_client() {
        let s = Server {
            name: "x".into(),
            url: "http://127.0.0.1:1/mcp".into(),
            ..Default::default()
        };
        assert_eq!(
            json_entry(&s, Style::Gemini).unwrap()["httpUrl"],
            "http://127.0.0.1:1/mcp"
        );
        assert!(json_entry(&s, Style::ClaudeDesktop).is_none());
    }

    #[test]
    fn names_are_clean() {
        assert_eq!(clean_name(" my server!"), "my-server");
    }
}
