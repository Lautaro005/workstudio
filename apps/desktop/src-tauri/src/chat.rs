//! The chat: one conversation view over the models the user already has. The agent CLIs (Claude
//! Code, Codex, Gemini) run headless with their own login and get the WorkStudio hub as their only
//! MCP server; Ollama models run here with the hub's tools; OpenCue agents answer through OpenCue's
//! own `send_to_agent`. The pills choose what the hub carries: brain, Lumina and the web tools.

use crate::hub::{Hub, McpChild};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct ToolUse {
    pub name: String,
    pub ok: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Msg {
    /// "user" | "assistant"
    pub role: String,
    pub text: String,
    pub ts: u64,
    pub model: String,
    pub tools: Vec<ToolUse>,
    pub error: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub model: String,
    pub tools: Vec<String>,
    pub messages: Vec<Msg>,
}

#[derive(Serialize, Clone)]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub model: String,
}

#[derive(Serialize, Clone)]
pub struct Model {
    /// "claude:sonnet", "codex:", "gemini:", "ollama:llama3.2", "opencue:pacman"
    pub id: String,
    pub name: String,
    /// "Claude Code" | "Codex" | "Gemini" | "Ollama" | "OpenCue"
    pub group: String,
    /// Can use the pills (MCP tools).
    pub tools: bool,
}

#[derive(Serialize, Clone)]
struct Event {
    chat: String,
    /// "delta" | "tool" | "tool_done" | "done" | "error"
    kind: String,
    text: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn dir() -> std::path::PathBuf {
    let d = crate::paths::ws_dir().join("chats");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn safe_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

pub fn load(id: &str) -> Option<Chat> {
    std::fs::read_to_string(dir().join(format!("{}.json", safe_id(id))))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn save(c: &Chat) {
    if let Ok(t) = serde_json::to_string(c) {
        let _ = crate::paths::write_atomic(&dir().join(format!("{}.json", safe_id(&c.id))), &t);
    }
}

pub fn list() -> Vec<ChatSummary> {
    let mut out: Vec<ChatSummary> = std::fs::read_dir(dir())
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
                .filter_map(|e| std::fs::read_to_string(e.path()).ok())
                .filter_map(|s| serde_json::from_str::<Chat>(&s).ok())
                .map(|c| ChatSummary {
                    id: c.id,
                    title: c.title,
                    updated: c.updated,
                    model: c.model,
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|c| std::cmp::Reverse(c.updated));
    out
}

pub fn delete(id: &str) {
    let _ = std::fs::remove_file(dir().join(format!("{}.json", safe_id(id))));
}

// ---------- models ----------

fn ollama_models() -> Vec<Model> {
    let Some(v) = crate::apps::http_get_json("http://127.0.0.1:11434/api/tags", 1500) else {
        return Vec::new();
    };
    v.get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            let caps: Vec<String> = m
                .get("capabilities")
                .and_then(|c| c.as_array())
                .map(|c| {
                    c.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            if caps.iter().any(|c| c == "embedding") && !caps.iter().any(|c| c == "completion") {
                return None;
            }
            Some(Model {
                id: format!("ollama:{name}"),
                name,
                group: "Ollama".into(),
                tools: caps.is_empty() || caps.iter().any(|c| c == "tools"),
            })
        })
        .collect()
}

/// Claude Code takes the aliases (always the newest of each family) and the full model ids.
const CLAUDE_MODELS: &[(&str, &str)] = &[
    ("opus", "Opus · latest"),
    ("sonnet", "Sonnet · latest"),
    ("haiku", "Haiku · latest"),
    ("claude-opus-5-5", "Claude Opus 5.5"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    ("claude-haiku-5-5", "Claude Haiku 5.5"),
    ("claude-fable-5-1", "Claude Fable 5.1"),
    ("claude-opus-5", "Claude Opus 5"),
    ("claude-sonnet-5", "Claude Sonnet 5"),
    ("claude-opus-4-8", "Claude Opus 4.8"),
    ("claude-opus-4-7", "Claude Opus 4.7"),
    ("claude-opus-4-6", "Claude Opus 4.6"),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("claude-opus-4-5", "Claude Opus 4.5"),
    ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
    ("claude-haiku-4-5", "Claude Haiku 4.5"),
];

/// Models Codex knows about, used when its own list (~/.codex/models_cache.json) is missing a family.
const CODEX_KNOWN: &[&str] = &[
    "gpt-6.1-sol",
    "gpt-6.1-terra",
    "gpt-6-sol",
    "gpt-6-astra",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
];

/// "gpt-6.1-sol" -> "GPT-6.1-Sol"
fn codex_name(slug: &str) -> String {
    slug.split('-')
        .map(|p| match p {
            "gpt" => "GPT".to_string(),
            _ => {
                let mut c = p.chars();
                match c.next() {
                    Some(f) if f.is_ascii_alphabetic() => f.to_uppercase().chain(c).collect(),
                    _ => p.to_string(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("-")
}

/// Version numbers of a slug, to sort newest first: "gpt-6.1-sol" -> [6, 1].
fn codex_version(slug: &str) -> Vec<u32> {
    slug.split('-')
        .nth(1)
        .unwrap_or("")
        .split('.')
        .map(|n| n.parse().unwrap_or(0))
        .collect()
}

/// The family after the version: "gpt-6.1-sol" -> "sol", "gpt-5.3-codex" -> "codex".
fn codex_family(slug: &str) -> String {
    slug.splitn(3, '-').nth(2).unwrap_or("").to_string()
}

/// Codex models: the ones the account lists first, then the other known versions, newest first,
/// with a "latest" entry per family on top.
pub fn codex_models(cache: Option<&Value>) -> Vec<(String, String)> {
    let mut slugs: Vec<(String, String)> = Vec::new();
    if let Some(list) = cache
        .and_then(|v| v.get("models"))
        .and_then(|m| m.as_array())
    {
        let mut listed: Vec<&Value> = list
            .iter()
            .filter(|m| m.get("visibility").and_then(|x| x.as_str()) == Some("list"))
            .collect();
        listed.sort_by_key(|m| m.get("priority").and_then(|x| x.as_i64()).unwrap_or(99));
        for m in listed {
            if let Some(slug) = m.get("slug").and_then(|x| x.as_str()) {
                let name = m
                    .get("display_name")
                    .and_then(|x| x.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| codex_name(slug));
                slugs.push((slug.to_string(), name));
            }
        }
    }
    let account: Vec<String> = slugs.iter().map(|(s, _)| s.clone()).collect();
    for k in CODEX_KNOWN {
        if !slugs.iter().any(|(s, _)| s == k) {
            slugs.push((k.to_string(), codex_name(k)));
        }
    }
    let mut versions = slugs.clone();
    versions.sort_by_key(|a| std::cmp::Reverse(codex_version(&a.0)));
    // "latest" prefers what the account lists, then the newest known.
    let mut ranked: Vec<(usize, &String)> = versions
        .iter()
        .map(|(s, _)| (if account.contains(s) { 0 } else { 1 }, s))
        .collect();
    ranked.sort_by_key(|(r, _)| *r);
    let mut latest: Vec<(String, String)> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for (_, slug) in ranked {
        let fam = codex_family(slug);
        if fam.is_empty() || seen.contains(&fam) {
            continue;
        }
        seen.push(fam.clone());
        let label = codex_name(&format!("gpt-x-{fam}"));
        let label = label.trim_start_matches("GPT-X-");
        latest.push((slug.clone(), format!("GPT {label} · latest")));
    }
    let mut out = vec![(String::new(), "Codex · predeterminado".to_string())];
    out.extend(latest.into_iter().map(|(s, n)| (format!("latest:{s}"), n)));
    out.extend(versions);
    out
}

pub fn models() -> Vec<Model> {
    let mut out = Vec::new();
    if crate::shellenv::has("claude") {
        for (id, name) in CLAUDE_MODELS {
            out.push(Model {
                id: format!("claude:{id}"),
                name: (*name).into(),
                group: "Claude Code".into(),
                tools: true,
            });
        }
    }
    if crate::shellenv::has("codex") {
        let cache = std::fs::read_to_string(
            crate::paths::home()
                .join(".codex")
                .join("models_cache.json"),
        )
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
        for (id, name) in codex_models(cache.as_ref()) {
            let name = if id.is_empty() {
                crate::settings::tr("Codex · predeterminado", "Codex · default").to_string()
            } else {
                name
            };
            out.push(Model {
                id: format!("codex:{id}"),
                name,
                group: "Codex".into(),
                tools: true,
            });
        }
    }
    if crate::shellenv::has("gemini") {
        out.push(Model {
            id: "gemini:".into(),
            name: "Gemini".into(),
            group: "Gemini".into(),
            tools: true,
        });
    }
    out.extend(ollama_models());
    for a in crate::mcp::opencue_agents() {
        out.push(Model {
            id: format!("opencue:{}", a.name),
            name: a.name,
            group: "OpenCue".into(),
            tools: false,
        });
    }
    out
}

// ---------- running ----------

/// Chats answering now: their cancel flag and the process doing the work.
type Running = Mutex<HashMap<String, (Arc<AtomicBool>, Option<u32>)>>;

fn running() -> &'static Running {
    static R: OnceLock<Running> = OnceLock::new();
    R.get_or_init(Default::default)
}

pub fn stop(chat: &str) {
    if let Some((flag, pid)) = running().lock().unwrap().get(chat).cloned() {
        flag.store(true, Ordering::SeqCst);
        if let Some(pid) = pid {
            kill_pid(pid);
        }
    }
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

struct Run {
    app: AppHandle,
    chat: String,
    cancel: Arc<AtomicBool>,
    text: String,
    tools: Vec<ToolUse>,
}

impl Run {
    fn emit(&self, kind: &str, text: &str) {
        let _ = self.app.emit(
            "chat-event",
            Event {
                chat: self.chat.clone(),
                kind: kind.into(),
                text: text.into(),
            },
        );
    }
    fn delta(&mut self, t: &str) {
        if t.is_empty() {
            return;
        }
        self.text.push_str(t);
        self.emit("delta", t);
    }
    fn tool(&mut self, name: &str) {
        let n = name
            .trim_start_matches("mcp__workstudio__")
            .trim_start_matches("workstudio__")
            .to_string();
        self.tools.push(ToolUse {
            name: n.clone(),
            ok: true,
        });
        self.emit("tool", &n);
    }
    fn set_pid(&self, pid: Option<u32>) {
        if let Some(e) = running().lock().unwrap().get_mut(&self.chat) {
            e.1 = pid;
        }
    }
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

fn system_prompt(tools: &[String]) -> String {
    let en = crate::settings::english();
    let mut s = String::from(if en {
        "You are the assistant in the chat of AI WorkStudio, the user's local workspace for brain, Lumina and OpenCue. Answer in the user's language, clearly and briefly, in Markdown."
    } else {
        "Sos el asistente del chat de AI WorkStudio, el espacio local del usuario para brain, Lumina y OpenCue. Respondé en el idioma del usuario, claro y breve, en Markdown."
    });
    if !tools.is_empty() {
        let names: Vec<&str> = tools
            .iter()
            .map(|t| match t.as_str() {
                "brain" => "brain__* (the user's knowledge base, memories and notes)",
                "lumina" => "lumina__* (the user's meetings, transcripts and notes)",
                "web" => "web__search and web__fetch (the web)",
                other => other,
            })
            .collect();
        s.push_str(&format!(
            "\n\nYou have these tools from the `workstudio` MCP server: {}. Use them when the question needs them, and say where an answer came from.",
            names.join("; ")
        ));
    }
    s
}

/// The whole conversation as one prompt, for the runners that take a single message.
fn transcript(c: &Chat, latest: &str) -> String {
    let en = crate::settings::english();
    let mut hist = String::new();
    for m in &c.messages {
        if m.error || m.text.trim().is_empty() {
            continue;
        }
        let who = if m.role == "user" {
            if en {
                "User"
            } else {
                "Usuario"
            }
        } else if en {
            "Assistant"
        } else {
            "Asistente"
        };
        hist.push_str(&format!("{who}: {}\n\n", m.text.trim()));
    }
    // Keep the end of long conversations.
    let chars: Vec<char> = hist.chars().collect();
    if chars.len() > 40_000 {
        hist = chars[chars.len() - 40_000..].iter().collect();
    }
    if hist.is_empty() {
        return latest.to_string();
    }
    if en {
        format!("Conversation so far:\n\n{hist}---\nNew message from the user:\n{latest}")
    } else {
        format!("Conversación hasta ahora:\n\n{hist}---\nMensaje nuevo del usuario:\n{latest}")
    }
}

fn hub_json(tools: &[String]) -> Value {
    let s = crate::mcp::hub_server(Some(tools));
    json!({"mcpServers": {"workstudio": {"type": "stdio", "command": s.command, "args": s.args}}})
}

fn spawn_lines(
    run: &mut Run,
    mut cmd: Command,
    mut on_line: impl FnMut(&mut Run, &str),
) -> anyhow::Result<(bool, String)> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(crate::paths::workspace_dir());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn()?;
    run.set_pid(Some(child.id()));
    let mut err_pipe = child.stderr.take();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(e) = err_pipe.as_mut() {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            on_line(run, &line);
        }
    }
    let status = child.wait()?;
    run.set_pid(None);
    let err = err_thread.join().unwrap_or_default();
    Ok((status.success(), err))
}

fn run_claude(run: &mut Run, model: &str, tools: &[String], prompt: &str) -> anyhow::Result<()> {
    let cfg = crate::paths::ws_dir()
        .join("mcp")
        .join(format!("chat-{}.json", safe_id(&run.chat)));
    crate::paths::write_atomic(&cfg, &serde_json::to_string(&hub_json(tools))?)?;
    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
    ])
    .args(["--model", if model.is_empty() { "sonnet" } else { model }])
    .args(["--append-system-prompt", &system_prompt(tools)])
    .args([
        "--tools",
        "",
        "--disable-slash-commands",
        "--strict-mcp-config",
    ]);
    if !tools.is_empty() {
        cmd.args([
            "--mcp-config",
            &cfg.to_string_lossy(),
            "--allowedTools",
            "mcp__workstudio",
        ]);
    }
    let mut result_err = String::new();
    let mut texted = false;
    let (ok, err) = spawn_lines(run, cmd, |run, line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match v["type"].as_str().unwrap_or("") {
            "stream_event" => {
                let ev = &v["event"];
                match ev["type"].as_str().unwrap_or("") {
                    "content_block_start" => {
                        let b = &ev["content_block"];
                        if b["type"] == "tool_use" {
                            run.tool(b["name"].as_str().unwrap_or("tool"));
                        } else if b["type"] == "text" && texted && !run.text.ends_with("\n\n") {
                            run.delta("\n\n");
                        }
                    }
                    "content_block_delta" if ev["delta"]["type"] == "text_delta" => {
                        texted = true;
                        run.delta(ev["delta"]["text"].as_str().unwrap_or(""));
                    }
                    _ => {}
                }
            }
            "result" => {
                if v["is_error"].as_bool().unwrap_or(false) {
                    result_err = v["result"]
                        .as_str()
                        .unwrap_or("Claude Code failed")
                        .to_string();
                } else if !texted {
                    run.delta(v["result"].as_str().unwrap_or(""));
                }
            }
            _ => {}
        }
    })?;
    let _ = std::fs::remove_file(&cfg);
    if !result_err.is_empty() {
        anyhow::bail!(result_err);
    }
    if !ok && !run.cancelled() && run.text.is_empty() {
        anyhow::bail!(last_lines(&err, "Claude Code"));
    }
    Ok(())
}

fn last_lines(err: &str, who: &str) -> String {
    let l: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
    if l.is_empty() {
        format!("{who} terminó con un error.")
    } else {
        l[l.len().saturating_sub(4)..].join("\n")
    }
}

fn run_codex(run: &mut Run, model: &str, tools: &[String], prompt: &str) -> anyhow::Result<()> {
    let mut cmd = Command::new("codex");
    cmd.args(["exec", "--json", "--skip-git-repo-check", "-s", "read-only"]);
    cmd.args(["-c", "approval_policy=\"never\""]);
    let model = model.strip_prefix("latest:").unwrap_or(model);
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    if !tools.is_empty() {
        for f in crate::mcp::codex_flags(&[crate::mcp::hub_server(Some(tools))]) {
            cmd.args(["-c", &f]);
        }
    }
    let full = format!("{}\n\n{}", system_prompt(tools), prompt);
    cmd.arg(full);
    let mut fail = String::new();
    let (ok, err) = spawn_lines(run, cmd, |run, line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let item = &v["item"];
        match (
            v["type"].as_str().unwrap_or(""),
            item["type"].as_str().unwrap_or(""),
        ) {
            ("item.started", "mcp_tool_call") => {
                run.tool(item["tool"].as_str().unwrap_or("tool"));
            }
            ("item.started", "web_search") => run.tool("web search"),
            ("item.started", "command_execution") => run.tool("shell"),
            ("item.completed", "agent_message") => {
                if !run.text.is_empty() {
                    run.delta("\n\n");
                }
                run.delta(item["text"].as_str().unwrap_or(""));
            }
            ("error", _) | ("turn.failed", _) => {
                fail = v["message"]
                    .as_str()
                    .or_else(|| v["error"]["message"].as_str())
                    .unwrap_or("Codex failed")
                    .to_string();
            }
            _ => {}
        }
    })?;
    if !fail.is_empty() && run.text.is_empty() {
        anyhow::bail!(fail);
    }
    if !ok && !run.cancelled() && run.text.is_empty() {
        anyhow::bail!(last_lines(&err, "Codex"));
    }
    Ok(())
}

fn run_gemini(run: &mut Run, model: &str, tools: &[String], prompt: &str) -> anyhow::Result<()> {
    // Gemini CLI reads its MCP servers from .gemini/settings.json in the folder it runs in.
    let folder = crate::paths::ws_dir().join("chat-gemini");
    let s = crate::mcp::hub_server(Some(tools));
    let settings = if tools.is_empty() {
        json!({})
    } else {
        json!({"mcpServers": {"workstudio": {"command": s.command, "args": s.args, "trust": true}}})
    };
    crate::paths::write_atomic(
        &folder.join(".gemini").join("settings.json"),
        &serde_json::to_string_pretty(&settings)?,
    )?;
    let mut cmd = Command::new("gemini");
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    cmd.args(["-p", &format!("{}\n\n{}", system_prompt(tools), prompt)]);
    if !tools.is_empty() {
        cmd.args(["--allowed-mcp-server-names", "workstudio", "-y"]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&folder);
    let mut child = cmd.spawn()?;
    run.set_pid(Some(child.id()));
    let mut out = child.stdout.take();
    let mut buf = [0u8; 2048];
    let mut pending: Vec<u8> = Vec::new();
    if let Some(o) = out.as_mut() {
        while let Ok(n) = o.read(&mut buf) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&buf[..n]);
            // Emit only complete UTF-8.
            let cut = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            let chunk = String::from_utf8_lossy(&pending[..cut]).into_owned();
            pending.drain(..cut);
            run.delta(&chunk);
        }
    }
    let mut err = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut err);
    }
    let status = child.wait()?;
    run.set_pid(None);
    if !status.success() && !run.cancelled() && run.text.trim().is_empty() {
        anyhow::bail!(last_lines(&err, "Gemini"));
    }
    Ok(())
}

/// Hubs for Ollama stay alive between messages (brain takes a few seconds to start).
fn cached_hub(tools: &[String]) -> Arc<Hub> {
    type Cached = Mutex<Option<(String, Arc<Hub>)>>;
    static H: OnceLock<Cached> = OnceLock::new();
    let key = tools.join(",");
    let mut g = H.get_or_init(Default::default).lock().unwrap();
    if let Some((k, h)) = g.as_ref() {
        if *k == key {
            return h.clone();
        }
    }
    crate::shellenv::extend_path();
    let h = Arc::new(Hub::start(Some(tools)));
    *g = Some((key, h.clone()));
    h
}

fn run_ollama(
    run: &mut Run,
    model: &str,
    tools: &[String],
    c: &Chat,
    latest: &str,
) -> anyhow::Result<()> {
    let hub = if tools.is_empty() {
        None
    } else {
        Some(cached_hub(tools))
    };
    let mut messages = vec![json!({"role": "system", "content": system_prompt(tools)})];
    for m in &c.messages {
        if m.error || m.text.trim().is_empty() {
            continue;
        }
        messages.push(
            json!({"role": if m.role == "user" { "user" } else { "assistant" }, "content": m.text}),
        );
    }
    messages.push(json!({"role": "user", "content": latest}));
    let tool_defs: Vec<Value> = hub
        .as_ref()
        .map(|h| {
            h.tools
                .iter()
                .map(|t| {
                    json!({"type": "function", "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t.get("inputSchema").cloned().unwrap_or(json!({"type": "object", "properties": {}})),
                    }})
                })
                .collect()
        })
        .unwrap_or_default();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(600))
        .build();
    for _round in 0..10 {
        let mut body = json!({"model": model, "messages": messages, "stream": true});
        if !tool_defs.is_empty() {
            body["tools"] = json!(tool_defs);
        }
        let res = agent
            .post("http://127.0.0.1:11434/api/chat")
            .send_json(body)
            .map_err(|e| match e {
                ureq::Error::Status(_, r) => anyhow::anyhow!(r.into_string().unwrap_or_default()),
                other => anyhow::anyhow!("Ollama: {other}"),
            })?;
        let mut content = String::new();
        let mut calls: Vec<Value> = Vec::new();
        for line in BufReader::new(res.into_reader()).lines() {
            if run.cancelled() {
                return Ok(());
            }
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
                anyhow::bail!("Ollama: {e}");
            }
            if let Some(t) = v["message"]["content"].as_str() {
                content.push_str(t);
                run.delta(t);
            }
            if let Some(tc) = v["message"]["tool_calls"].as_array() {
                calls.extend(tc.iter().cloned());
            }
        }
        if calls.is_empty() {
            return Ok(());
        }
        messages.push(json!({"role": "assistant", "content": content, "tool_calls": calls}));
        let Some(h) = hub.as_ref() else { return Ok(()) };
        for call in &calls {
            let name = call["function"]["name"].as_str().unwrap_or("");
            let mut args = call["function"]["arguments"].clone();
            if let Some(s) = args.as_str() {
                args = serde_json::from_str(s).unwrap_or(json!({}));
            }
            run.tool(name);
            let r = h.call(name, args);
            let text: String = r["content"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_else(|| r.to_string());
            if r["isError"].as_bool().unwrap_or(false) {
                if let Some(t) = run.tools.last_mut() {
                    t.ok = false;
                }
            }
            run.emit("tool_done", name);
            let clipped: String = text.chars().take(24_000).collect();
            messages.push(json!({"role": "tool", "content": clipped, "tool_name": name}));
        }
        if !run.text.is_empty() && !run.text.ends_with("\n\n") {
            run.delta("\n\n");
        }
    }
    Ok(())
}

fn run_opencue(run: &mut Run, agent: &str, prompt: &str) -> anyhow::Result<()> {
    let agents = crate::mcp::opencue_agents();
    let target = agents
        .iter()
        .find(|a| a.name == agent)
        .ok_or_else(|| anyhow::anyhow!("No encontré el agente {agent} en OpenCue"))?;
    // OpenCue delivers the message from another agent; any other one works as the sender.
    let from = agents
        .iter()
        .find(|a| a.id != target.id)
        .unwrap_or(target)
        .id
        .clone();
    // The OpenCue app does the work: make sure it is open.
    if let Some(app) = crate::catalog::get("opencue") {
        if !crate::apps::status(&app, false).running {
            let _ = crate::apps::start(&app);
            std::thread::sleep(Duration::from_secs(4));
        }
    }
    crate::shellenv::extend_path();
    let cli = which::which("opencue")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "opencue".into());
    let server = crate::mcp::Server {
        name: "opencue".into(),
        command: cli,
        args: vec!["mcp-serve".into(), "--agent".into(), from],
        ..Default::default()
    };
    let child = McpChild::start(&server, Duration::from_secs(30))?;
    run.tool(&format!("OpenCue → {agent}"));
    let r = child.call(
        "send_to_agent",
        json!({"agent": agent, "message": prompt}),
        Duration::from_secs(1800),
    )?;
    let text: String = r["content"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if r["isError"].as_bool().unwrap_or(false) {
        anyhow::bail!(text);
    }
    let prefix = format!("[{agent}]:");
    run.delta(
        text.trim()
            .strip_prefix(&prefix)
            .unwrap_or(text.trim())
            .trim(),
    );
    Ok(())
}

/// Adds the user's message, answers it in the background and returns the chat id at once.
pub fn send(
    app: AppHandle,
    chat_id: Option<String>,
    text: String,
    model: String,
    tools: Vec<String>,
) -> anyhow::Result<String> {
    let text = text.trim().to_string();
    anyhow::ensure!(!text.is_empty(), "Escribí un mensaje");
    let mut c = chat_id.as_deref().and_then(load).unwrap_or_else(|| Chat {
        id: format!("{:x}", now()),
        created: now(),
        ..Default::default()
    });
    anyhow::ensure!(
        !running().lock().unwrap().contains_key(&c.id),
        "Esperá a que termine la respuesta"
    );
    if c.title.is_empty() {
        let t: String = text.lines().next().unwrap_or("").chars().take(60).collect();
        c.title = t;
    }
    let prior = c.clone();
    c.model = model.clone();
    c.tools = tools.clone();
    c.updated = now();
    c.messages.push(Msg {
        role: "user".into(),
        text: text.clone(),
        ts: now(),
        ..Default::default()
    });
    save(&c);
    let id = c.id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    running()
        .lock()
        .unwrap()
        .insert(id.clone(), (cancel.clone(), None));
    std::thread::spawn(move || {
        let mut run = Run {
            app,
            chat: c.id.clone(),
            cancel,
            text: String::new(),
            tools: Vec::new(),
        };
        let (kind, name) = model.split_once(':').unwrap_or((model.as_str(), ""));
        let prompt = transcript(&prior, &text);
        let res = match kind {
            "claude" => run_claude(&mut run, name, &tools, &prompt),
            "codex" => run_codex(&mut run, name, &tools, &prompt),
            "gemini" => run_gemini(&mut run, name, &tools, &prompt),
            "ollama" => run_ollama(&mut run, name, &tools, &prior, &text),
            "opencue" => run_opencue(&mut run, name, &prompt),
            _ => Err(anyhow::anyhow!("Elegí un modelo")),
        };
        let (msg_text, error) = match res {
            Ok(()) if run.cancelled() && run.text.is_empty() => (
                crate::settings::tr("Respuesta cancelada.", "Answer cancelled.").to_string(),
                true,
            ),
            Ok(()) => (run.text.clone(), false),
            Err(e) => {
                let mut t = run.text.clone();
                if !t.is_empty() {
                    t.push_str("\n\n");
                }
                t.push_str(&e.to_string());
                (t, true)
            }
        };
        if let Some(mut saved) = load(&c.id) {
            saved.messages.push(Msg {
                role: "assistant".into(),
                text: msg_text.clone(),
                ts: now(),
                model: model.clone(),
                tools: run.tools.clone(),
                error,
            });
            saved.updated = now();
            save(&saved);
        }
        running().lock().unwrap().remove(&c.id);
        run.emit(if error { "error" } else { "done" }, &msg_text);
    });
    Ok(id)
}

pub fn is_running(chat: &str) -> bool {
    running().lock().unwrap().contains_key(chat)
}

#[cfg(test)]
mod model_tests {
    use super::*;

    #[test]
    fn codex_list_puts_account_models_and_latest_first() {
        let cache = json!({"models": [
            {"slug": "gpt-5.6-luna", "display_name": "GPT-5.6-Luna", "visibility": "list", "priority": 9},
            {"slug": "gpt-6-luna", "display_name": "GPT-6-Luna", "visibility": "list", "priority": 5},
            {"slug": "gpt-reserve", "visibility": "hide", "priority": 4}
        ]});
        let m = codex_models(Some(&cache));
        assert_eq!(m[0].0, "");
        assert!(m
            .iter()
            .any(|(id, n)| id == "latest:gpt-6-luna" && n == "GPT Luna · latest"));
        assert!(m.iter().any(|(id, _)| id == "latest:gpt-6.1-sol"));
        assert!(!m.iter().any(|(id, _)| id.contains("reserve")));
        assert_eq!(codex_name("gpt-5.1-codex-max"), "GPT-5.1-Codex-Max");
        // Versions come newest first.
        let v: Vec<&str> = m
            .iter()
            .filter(|(id, _)| !id.is_empty() && !id.starts_with("latest:"))
            .map(|(id, _)| id.as_str())
            .collect();
        assert_eq!(v[0], "gpt-6.1-sol");
    }
}
