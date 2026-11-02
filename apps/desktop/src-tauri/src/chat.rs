//! The chat: one conversation view over the models the user already has. The agent CLIs (Claude
//! Code, Codex, Gemini) run headless with their own login and get the WorkStudio hub as their only
//! MCP server; Ollama models run here with the hub's tools; OpenCue agents answer through OpenCue's
//! own `send_to_agent` (picked in the model menu or @mentioned in a message). The pills choose what
//! the hub carries: brain, Lumina and the web tools. Chats can belong to a project, work in a folder
//! (read-only or editing), carry attached files and use skills; `prompt.rs` builds the system prompt.

use crate::hub::{Hub, McpChild};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
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
    /// What it worked on: a file, a query, a command.
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Attachment {
    pub name: String,
    pub path: String,
    /// "text" | "image" | "pdf" | "file"
    pub kind: String,
    pub size: u64,
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
    pub files: Vec<Attachment>,
    /// The model's visible reasoning, when it shares it.
    pub thinking: String,
    /// OpenCue agent the message was handed to with @name.
    pub agent: String,
    /// Skills that were on for this message (names).
    pub skills: Vec<String>,
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
    /// Project id ("" = none).
    pub project: String,
    /// Working folder ("" = none) and "read" | "edit".
    pub folder: String,
    pub mode: String,
    /// SKILL.md paths switched on in this chat.
    pub skills: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub model: String,
    pub project: String,
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
    /// "delta" | "thinking" | "tool" | "tool_detail" | "tool_done" | "done" | "error"
    kind: String,
    text: String,
}

pub fn now() -> u64 {
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
                    project: c.project,
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|c| std::cmp::Reverse(c.updated));
    out
}

pub fn delete(id: &str) {
    let _ = std::fs::remove_file(dir().join(format!("{}.json", safe_id(id))));
    let _ = std::fs::remove_dir_all(files_dir(id));
}

/// Renames a chat or moves it into (or out of) a project.
pub fn update(id: &str, title: Option<String>, project: Option<String>) -> anyhow::Result<Chat> {
    let mut c = load(id).ok_or_else(|| anyhow::anyhow!("No encontré el chat"))?;
    if let Some(t) = title {
        let t = t.trim();
        if !t.is_empty() {
            c.title = t.chars().take(120).collect();
        }
    }
    if let Some(p) = project {
        c.project = p;
    }
    save(&c);
    Ok(c)
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

// ---------- attachments ----------

const TEXT_EXT: &[&str] = &[
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cpp",
    "hpp",
    "cc",
    "cs",
    "php",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "sql",
    "r",
    "lua",
    "dart",
    "vue",
    "svelte",
    "ini",
    "cfg",
    "conf",
    "env",
    "log",
    "tex",
    "bib",
    "srt",
    "vtt",
    "rst",
    "org",
    "svg",
    "gradle",
    "dockerfile",
    "makefile",
    "mdx",
    "ipynb",
];
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

fn ext_of(p: &Path) -> String {
    p.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        })
}

/// "text" | "image" | "pdf" | "file"
pub fn kind_of(p: &Path) -> String {
    let ext = ext_of(p);
    if IMAGE_EXT.contains(&ext.as_str()) {
        return "image".into();
    }
    if ext == "pdf" {
        return "pdf".into();
    }
    if TEXT_EXT.contains(&ext.as_str()) {
        return "text".into();
    }
    // Unknown extension: text when the start of the file is valid UTF-8 without NULs.
    if let Ok(mut f) = std::fs::File::open(p) {
        let mut buf = vec![0u8; 8192];
        if let Ok(n) = f.read(&mut buf) {
            buf.truncate(n);
            if n > 0 && !buf.contains(&0) && std::str::from_utf8(&buf).is_ok() {
                return "text".into();
            }
        }
    }
    "file".into()
}

/// Name, kind and size of files the user picked or dropped.
pub fn inspect(paths: &[String]) -> Vec<Attachment> {
    paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .map(|p| Attachment {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            kind: kind_of(&p),
            size: std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            path: p.to_string_lossy().into_owned(),
        })
        .collect()
}

/// Saves a pasted image (base64) and returns it as an attachment.
pub fn save_blob(name: &str, data: &str) -> anyhow::Result<Attachment> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.split(',').next_back().unwrap_or(data))?;
    anyhow::ensure!(bytes.len() < 30_000_000, "El archivo es muy grande");
    let d = dir().join("files").join("_pasted");
    std::fs::create_dir_all(&d)?;
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let p = d.join(format!("{:x}-{}", now(), clean));
    std::fs::write(&p, &bytes)?;
    Ok(inspect(&[p.to_string_lossy().into_owned()])
        .pop()
        .unwrap_or_default())
}

fn files_dir(chat: &str) -> PathBuf {
    dir().join("files").join(safe_id(chat))
}

/// Copies the attachments next to the chat, so they stay even if the originals move.
fn store_files(chat: &str, files: &[Attachment]) -> Vec<Attachment> {
    let d = files_dir(chat);
    let _ = std::fs::create_dir_all(&d);
    let mut out = Vec::new();
    for f in files {
        let src = Path::new(&f.path);
        if !src.is_file() {
            continue;
        }
        if src.starts_with(&d) {
            out.push(f.clone());
            continue;
        }
        let mut dest = d.join(&f.name);
        let mut n = 1;
        while dest.exists() {
            n += 1;
            let stem = Path::new(&f.name)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let ext = Path::new(&f.name)
                .extension()
                .map(|s| format!(".{}", s.to_string_lossy()))
                .unwrap_or_default();
            dest = d.join(format!("{stem}-{n}{ext}"));
        }
        if std::fs::copy(src, &dest).is_ok() {
            out.push(Attachment {
                path: dest.to_string_lossy().into_owned(),
                kind: if f.kind.is_empty() {
                    kind_of(&dest)
                } else {
                    f.kind.clone()
                },
                ..f.clone()
            });
        }
    }
    out
}

pub fn read_text(p: &str, max: usize) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut t: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        t.push_str("\n…[truncated]");
    }
    Some(t)
}

/// A user message as the model reads it: its text plus the text of the files it carries.
fn user_content(m: &Msg) -> String {
    let mut s = m.text.trim().to_string();
    for f in &m.files {
        if f.kind == "text" {
            if let Some(t) = read_text(&f.path, 100_000) {
                s.push_str(&format!(
                    "\n\n<file name=\"{}\" path=\"{}\">\n{}\n</file>",
                    f.name, f.path, t
                ));
                continue;
            }
        }
        s.push_str(&format!(
            "\n\n<attachment name=\"{}\" kind=\"{}\" path=\"{}\" />",
            f.name, f.kind, f.path
        ));
    }
    s
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
    thinking: String,
    tools: Vec<ToolUse>,
    /// Provider ids of the tools, in the same order, to match results to them.
    tool_ids: Vec<String>,
}

fn clean_tool(name: &str) -> String {
    name.trim_start_matches("mcp__workstudio__")
        .trim_start_matches("workstudio__")
        .to_string()
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
    fn think(&mut self, t: &str) {
        if t.is_empty() {
            return;
        }
        self.thinking.push_str(t);
        self.emit("thinking", t);
    }
    /// A tool started; returns its index.
    fn tool(&mut self, name: &str, id: &str) -> usize {
        let n = clean_tool(name);
        self.tools.push(ToolUse {
            name: n.clone(),
            ok: true,
            detail: String::new(),
        });
        self.tool_ids.push(id.to_string());
        self.emit("tool", &n);
        self.tools.len() - 1
    }
    fn index_of(&self, id: &str) -> Option<usize> {
        if id.is_empty() {
            return None;
        }
        self.tool_ids.iter().position(|x| x == id)
    }
    fn tool_detail(&mut self, i: usize, detail: &str) {
        let d: String = detail
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(120)
            .collect();
        if d.is_empty() {
            return;
        }
        if let Some(t) = self.tools.get_mut(i) {
            t.detail = d.clone();
            self.emit("tool_detail", &json!({"i": i, "detail": d}).to_string());
        }
    }
    fn tool_done(&mut self, i: usize, ok: bool) {
        if let Some(t) = self.tools.get_mut(i) {
            t.ok = ok;
            self.emit("tool_done", &json!({"i": i, "ok": ok}).to_string());
        }
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

/// The most useful argument of a tool call, to show next to its name.
fn input_detail(input: &Value) -> String {
    for k in [
        "file_path",
        "path",
        "pattern",
        "query",
        "q",
        "url",
        "command",
        "cmd",
        "notebook_path",
        "name",
        "agent",
    ] {
        if let Some(s) = input.get(k).and_then(|v| v.as_str()) {
            return s.to_string();
        }
        if let Some(a) = input.get(k).and_then(|v| v.as_array()) {
            let parts: Vec<String> = a
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect();
            if !parts.is_empty() {
                return parts.join(" ");
            }
        }
    }
    String::new()
}

/// Everything one answer needs to run.
struct Job {
    kind: String,
    model: String,
    tools: Vec<String>,
    system: String,
    /// The conversation as one prompt (for runners that take a single message).
    prompt: String,
    /// The chat before the new message, and the new message (for Ollama).
    prior: Chat,
    latest: Msg,
    folder: String,
    mode: String,
    /// Folders the model may read (working folder, attachments, skills).
    roots: Vec<String>,
}

/// The whole conversation as one prompt, for the runners that take a single message.
fn transcript(c: &Chat, latest: &Msg) -> String {
    let en = crate::settings::english();
    let mut hist = String::new();
    for m in &c.messages {
        if m.error || (m.text.trim().is_empty() && m.files.is_empty()) {
            continue;
        }
        let who = if m.role == "user" {
            if en {
                "User"
            } else {
                "Usuario"
            }
        } else if !m.agent.is_empty() {
            &m.agent
        } else if en {
            "Assistant"
        } else {
            "Asistente"
        };
        let body = if m.role == "user" {
            user_content(m)
        } else {
            m.text.trim().to_string()
        };
        hist.push_str(&format!("{who}: {body}\n\n"));
    }
    // Keep the end of long conversations.
    let chars: Vec<char> = hist.chars().collect();
    if chars.len() > 120_000 {
        hist = chars[chars.len() - 120_000..].iter().collect();
    }
    let now = user_content(latest);
    if hist.is_empty() {
        return now;
    }
    if en {
        format!("Conversation so far:\n\n{hist}---\nNew message from the user:\n{now}")
    } else {
        format!("Conversación hasta ahora:\n\n{hist}---\nMensaje nuevo del usuario:\n{now}")
    }
}

fn hub_json(tools: &[String]) -> Value {
    let s = crate::mcp::hub_server(Some(tools));
    json!({"mcpServers": {"workstudio": {"type": "stdio", "command": s.command, "args": s.args}}})
}

fn spawn_lines(
    run: &mut Run,
    mut cmd: Command,
    cwd: &Path,
    mut on_line: impl FnMut(&mut Run, &str),
) -> anyhow::Result<(bool, String)> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(cwd);
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

fn cwd_for(job: &Job) -> PathBuf {
    if !job.folder.is_empty() {
        let p = crate::paths::expand_path(&job.folder);
        if p.is_dir() {
            return p;
        }
    }
    crate::paths::workspace_dir()
}

/// Claude Code's tools for the chat: reading tools when there is something to read, editing
/// tools only in a folder the user opened for editing.
pub fn claude_tools(read: bool, edit: bool) -> Vec<&'static str> {
    let mut t = Vec::new();
    if read || edit {
        t.extend(["Read", "Glob", "Grep"]);
    }
    if edit {
        t.extend(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"]);
    }
    t
}

fn run_claude(run: &mut Run, job: &Job) -> anyhow::Result<()> {
    let cfg = crate::paths::ws_dir()
        .join("mcp")
        .join(format!("chat-{}.json", safe_id(&run.chat)));
    crate::paths::write_atomic(&cfg, &serde_json::to_string(&hub_json(&job.tools))?)?;
    let edit = job.mode == "edit" && !job.folder.is_empty();
    let builtin = claude_tools(!job.roots.is_empty(), edit);
    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        &job.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
    ])
    .args([
        "--model",
        if job.model.is_empty() {
            "sonnet"
        } else {
            &job.model
        },
    ]);
    // A plain chat replaces Claude Code's coding persona; editing a folder keeps it and adds ours.
    if edit {
        cmd.args(["--append-system-prompt", &job.system]);
    } else {
        cmd.args(["--system-prompt", &job.system]);
    }
    cmd.args([
        "--tools",
        &builtin.join(","),
        "--disable-slash-commands",
        "--strict-mcp-config",
    ]);
    for r in &job.roots {
        cmd.args(["--add-dir", r]);
    }
    let mut allowed: Vec<String> = builtin.iter().map(|s| s.to_string()).collect();
    if !job.tools.is_empty() {
        cmd.args(["--mcp-config", &cfg.to_string_lossy()]);
        allowed.push("mcp__workstudio".into());
    }
    if !allowed.is_empty() {
        cmd.args(["--allowedTools", &allowed.join(",")]);
    }
    if edit {
        cmd.args(["--permission-mode", "acceptEdits"]);
    }
    let mut result_err = String::new();
    let mut texted = false;
    let cwd = cwd_for(job);
    let (ok, err) = spawn_lines(run, cmd, &cwd, |run, line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match v["type"].as_str().unwrap_or("") {
            "stream_event" => {
                let ev = &v["event"];
                match ev["type"].as_str().unwrap_or("") {
                    "content_block_start" => {
                        let b = &ev["content_block"];
                        if b["type"] == "tool_use" || b["type"] == "server_tool_use" {
                            run.tool(
                                b["name"].as_str().unwrap_or("tool"),
                                b["id"].as_str().unwrap_or(""),
                            );
                        } else if b["type"] == "text" && texted && !run.text.ends_with("\n\n") {
                            run.delta("\n\n");
                        }
                    }
                    "content_block_delta" => match ev["delta"]["type"].as_str().unwrap_or("") {
                        "text_delta" => {
                            texted = true;
                            run.delta(ev["delta"]["text"].as_str().unwrap_or(""));
                        }
                        "thinking_delta" => {
                            run.think(ev["delta"]["thinking"].as_str().unwrap_or(""));
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }
            // Whole messages: the inputs of the tools it called, and their results.
            "assistant" => {
                if let Some(blocks) = v["message"]["content"].as_array() {
                    for b in blocks {
                        if b["type"] == "tool_use" {
                            if let Some(i) = run.index_of(b["id"].as_str().unwrap_or("")) {
                                let d = input_detail(&b["input"]);
                                run.tool_detail(i, &d);
                            }
                        }
                    }
                }
            }
            "user" => {
                if let Some(blocks) = v["message"]["content"].as_array() {
                    for b in blocks {
                        if b["type"] == "tool_result" {
                            if let Some(i) = run.index_of(b["tool_use_id"].as_str().unwrap_or("")) {
                                run.tool_done(i, !b["is_error"].as_bool().unwrap_or(false));
                            }
                        }
                    }
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

fn run_codex(run: &mut Run, job: &Job) -> anyhow::Result<()> {
    let edit = job.mode == "edit" && !job.folder.is_empty();
    let mut cmd = Command::new("codex");
    cmd.args([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-s",
        if edit { "workspace-write" } else { "read-only" },
    ]);
    cmd.args(["-c", "approval_policy=\"never\""]);
    let cwd = cwd_for(job);
    cmd.args(["-C", &cwd.to_string_lossy()]);
    let model = job.model.strip_prefix("latest:").unwrap_or(&job.model);
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    if !job.tools.is_empty() {
        for f in crate::mcp::codex_flags(&[crate::mcp::hub_server(Some(&job.tools))]) {
            cmd.args(["-c", &f]);
        }
    }
    for f in job.latest.files.iter().filter(|f| f.kind == "image") {
        cmd.args(["-i", &f.path]);
    }
    cmd.arg(format!(
        "<instructions>\n{}\n</instructions>\n\n{}",
        job.system, job.prompt
    ));
    let mut fail = String::new();
    let (ok, err) = spawn_lines(run, cmd, &cwd, |run, line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let item = &v["item"];
        let id = item["id"].as_str().unwrap_or("");
        match (
            v["type"].as_str().unwrap_or(""),
            item["type"].as_str().unwrap_or(""),
        ) {
            ("item.started", "mcp_tool_call") => {
                let i = run.tool(item["tool"].as_str().unwrap_or("tool"), id);
                let d = input_detail(&item["arguments"]);
                run.tool_detail(i, &d);
            }
            ("item.started", "web_search") => {
                let i = run.tool("web search", id);
                run.tool_detail(i, item["query"].as_str().unwrap_or(""));
            }
            ("item.started", "command_execution") => {
                let i = run.tool("shell", id);
                run.tool_detail(i, item["command"].as_str().unwrap_or(""));
            }
            ("item.completed", "file_change") => {
                let i = run.tool("edit", id);
                let paths: Vec<String> = item["changes"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|c| c["path"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                run.tool_detail(i, &paths.join(", "));
                run.tool_done(i, item["status"].as_str() != Some("failed"));
            }
            ("item.completed", "mcp_tool_call")
            | ("item.completed", "command_execution")
            | ("item.completed", "web_search") => {
                if let Some(i) = run.index_of(id) {
                    let st = item["status"].as_str().unwrap_or("");
                    run.tool_done(i, st != "failed" && st != "declined");
                }
            }
            ("item.completed", "reasoning") => {
                let t = item["text"].as_str().unwrap_or("");
                if !run.thinking.is_empty() {
                    run.think("\n\n");
                }
                run.think(t);
            }
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

fn run_gemini(run: &mut Run, job: &Job) -> anyhow::Result<()> {
    // Gemini CLI reads its MCP servers from .gemini/settings.json in the folder it runs in.
    let folder = crate::paths::ws_dir().join("chat-gemini");
    let s = crate::mcp::hub_server(Some(&job.tools));
    let settings = if job.tools.is_empty() {
        json!({})
    } else {
        json!({"mcpServers": {"workstudio": {"command": s.command, "args": s.args, "trust": true}}})
    };
    crate::paths::write_atomic(
        &folder.join(".gemini").join("settings.json"),
        &serde_json::to_string_pretty(&settings)?,
    )?;
    let edit = job.mode == "edit" && !job.folder.is_empty();
    let mut cmd = Command::new("gemini");
    if !job.model.is_empty() {
        cmd.args(["-m", &job.model]);
    }
    cmd.args(["-p", &format!("{}\n\n{}", job.system, job.prompt)]);
    if !job.roots.is_empty() {
        cmd.args(["--include-directories", &job.roots.join(",")]);
    }
    if !job.tools.is_empty() {
        cmd.args(["--allowed-mcp-server-names", "workstudio"]);
    }
    if edit {
        cmd.arg("-y");
    } else if !job.roots.is_empty() {
        cmd.args([
            "--allowed-tools",
            "read_file,read_many_files,list_directory,glob,search_file_content",
        ]);
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

// ---------- read-only file tools for Ollama ----------

fn fs_tool_defs() -> Vec<Value> {
    vec![
        json!({"type": "function", "function": {
            "name": "fs__list",
            "description": "List the files and folders in a directory (the working folder, attachments or skills).",
            "parameters": {"type": "object", "properties": {"path": {"type": "string", "description": "Absolute path, or relative to the working folder."}}, "required": ["path"]}
        }}),
        json!({"type": "function", "function": {
            "name": "fs__read",
            "description": "Read a UTF-8 text file. Returns numbered lines.",
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string"},
                "offset": {"type": "integer", "description": "1-based first line (default 1)"},
                "limit": {"type": "integer", "description": "Lines to read (default 400)"}
            }, "required": ["path"]}
        }}),
        json!({"type": "function", "function": {
            "name": "fs__search",
            "description": "Find lines containing some text in the files under a folder (case-insensitive).",
            "parameters": {"type": "object", "properties": {
                "text": {"type": "string"},
                "path": {"type": "string", "description": "Folder to search (default: the working folder)"}
            }, "required": ["text"]}
        }}),
    ]
}

/// Resolves a path and checks it stays inside one of the allowed folders.
fn inside(roots: &[String], base: &str, p: &str) -> Option<PathBuf> {
    let raw = crate::paths::expand_path(p);
    let full = if raw.is_absolute() || base.is_empty() {
        raw
    } else {
        crate::paths::expand_path(base).join(raw)
    };
    let full = full.canonicalize().ok()?;
    roots
        .iter()
        .filter_map(|r| crate::paths::expand_path(r).canonicalize().ok())
        .any(|r| full.starts_with(&r))
        .then_some(full)
}

pub fn fs_call(roots: &[String], base: &str, name: &str, args: &Value) -> (String, bool) {
    let path = args["path"]
        .as_str()
        .unwrap_or(if base.is_empty() { "" } else { "." });
    let denied = || {
        (
            "Not allowed: that path is outside the folders this chat can read.".to_string(),
            false,
        )
    };
    match name {
        "fs__list" => {
            let Some(p) = inside(roots, base, path) else {
                return denied();
            };
            let Ok(rd) = std::fs::read_dir(&p) else {
                return ("Not a folder.".into(), false);
            };
            let mut items: Vec<String> = rd
                .flatten()
                .map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    if e.path().is_dir() {
                        format!("{n}/")
                    } else {
                        n
                    }
                })
                .collect();
            items.sort();
            items.truncate(500);
            (items.join("\n"), true)
        }
        "fs__read" => {
            let Some(p) = inside(roots, base, path) else {
                return denied();
            };
            let Ok(text) = std::fs::read_to_string(&p) else {
                return ("Can't read that file as text.".into(), false);
            };
            let off = args["offset"].as_u64().unwrap_or(1).max(1) as usize;
            let lim = args["limit"].as_u64().unwrap_or(400).clamp(1, 2000) as usize;
            let out: Vec<String> = text
                .lines()
                .enumerate()
                .skip(off - 1)
                .take(lim)
                .map(|(i, l)| format!("{:>5}  {l}", i + 1))
                .collect();
            (out.join("\n"), true)
        }
        "fs__search" => {
            let Some(p) = inside(roots, base, path) else {
                return denied();
            };
            let needle = args["text"].as_str().unwrap_or("").to_lowercase();
            if needle.is_empty() {
                return ("Say what to search for.".into(), false);
            }
            let mut hits = Vec::new();
            let mut stack = vec![p];
            let mut seen = 0;
            while let Some(d) = stack.pop() {
                let Ok(rd) = std::fs::read_dir(&d) else {
                    continue;
                };
                for e in rd.flatten() {
                    let ep = e.path();
                    let n = e.file_name().to_string_lossy().into_owned();
                    if n.starts_with('.') || n == "node_modules" || n == "target" {
                        continue;
                    }
                    if ep.is_dir() {
                        stack.push(ep);
                        continue;
                    }
                    seen += 1;
                    if seen > 5000 || hits.len() >= 200 {
                        break;
                    }
                    if let Ok(t) = std::fs::read_to_string(&ep) {
                        for (i, l) in t.lines().enumerate() {
                            if l.to_lowercase().contains(&needle) {
                                hits.push(format!("{}:{}: {}", ep.display(), i + 1, l.trim()));
                                if hits.len() >= 200 {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if hits.is_empty() {
                ("No matches.".into(), true)
            } else {
                (hits.join("\n"), true)
            }
        }
        _ => ("Unknown tool".into(), false),
    }
}

fn run_ollama(run: &mut Run, job: &Job) -> anyhow::Result<()> {
    use base64::Engine;
    let hub = if job.tools.is_empty() {
        None
    } else {
        Some(cached_hub(&job.tools))
    };
    let mut messages = vec![json!({"role": "system", "content": job.system})];
    for m in &job.prior.messages {
        if m.error || (m.text.trim().is_empty() && m.files.is_empty()) {
            continue;
        }
        let content = if m.role == "user" {
            user_content(m)
        } else {
            m.text.clone()
        };
        messages.push(json!({"role": if m.role == "user" { "user" } else { "assistant" }, "content": content}));
    }
    let images: Vec<String> = job
        .latest
        .files
        .iter()
        .filter(|f| f.kind == "image")
        .filter_map(|f| std::fs::read(&f.path).ok())
        .map(|b| base64::engine::general_purpose::STANDARD.encode(b))
        .collect();
    let mut last = json!({"role": "user", "content": user_content(&job.latest)});
    if !images.is_empty() {
        last["images"] = json!(images);
    }
    messages.push(last);
    let mut tool_defs: Vec<Value> = hub
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
    if !job.roots.is_empty() {
        tool_defs.extend(fs_tool_defs());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(600))
        .build();
    for _round in 0..12 {
        let mut body = json!({"model": job.model, "messages": messages, "stream": true});
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
            if let Some(t) = v["message"]["thinking"].as_str() {
                run.think(t);
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
        for call in &calls {
            let name = call["function"]["name"].as_str().unwrap_or("");
            let mut args = call["function"]["arguments"].clone();
            if let Some(s) = args.as_str() {
                args = serde_json::from_str(s).unwrap_or(json!({}));
            }
            let i = run.tool(name, "");
            run.tool_detail(i, &input_detail(&args));
            let (text, ok) = if name.starts_with("fs__") {
                fs_call(&job.roots, &job.folder, name, &args)
            } else if let Some(h) = hub.as_ref() {
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
                (text, !r["isError"].as_bool().unwrap_or(false))
            } else {
                ("Unknown tool".into(), false)
            };
            run.tool_done(i, ok);
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
        .find(|a| a.name.eq_ignore_ascii_case(agent))
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
    let i = run.tool(&format!("OpenCue → {}", target.name), "");
    let r = child.call(
        "send_to_agent",
        json!({"agent": target.name, "message": prompt}),
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
    let bad = r["isError"].as_bool().unwrap_or(false);
    run.tool_done(i, !bad);
    if bad {
        anyhow::bail!(text);
    }
    let prefix = format!("[{}]:", target.name);
    run.delta(
        text.trim()
            .strip_prefix(&prefix)
            .unwrap_or(text.trim())
            .trim(),
    );
    Ok(())
}

// ---------- sending ----------

/// What the composer sends.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct SendOpts {
    pub chat: Option<String>,
    pub text: String,
    pub model: String,
    pub tools: Vec<String>,
    pub files: Vec<Attachment>,
    /// SKILL.md paths on for this chat.
    pub skills: Vec<String>,
    pub project: String,
    pub folder: String,
    pub mode: String,
    /// OpenCue agent @mentioned: the message goes to it.
    pub agent: String,
    /// Keep only this many messages before adding the new one (edit or regenerate).
    pub truncate: Option<usize>,
    pub client: crate::prompt::Client,
}

/// Can this model run tools (the hub, file reading)?
fn runner_tools(kind: &str) -> bool {
    matches!(kind, "claude" | "codex" | "gemini" | "ollama")
}

/// Adds the user's message, answers it in the background and returns the chat id at once.
pub fn send(app: AppHandle, o: SendOpts) -> anyhow::Result<String> {
    let text = o.text.trim().to_string();
    anyhow::ensure!(
        !text.is_empty() || !o.files.is_empty(),
        "Escribí un mensaje"
    );
    let mut c = o.chat.as_deref().and_then(load).unwrap_or_else(|| Chat {
        id: format!("{:x}", now()),
        created: now(),
        project: o.project.clone(),
        ..Default::default()
    });
    anyhow::ensure!(
        !running().lock().unwrap().contains_key(&c.id),
        "Esperá a que termine la respuesta"
    );
    if let Some(n) = o.truncate {
        c.messages.truncate(n);
    }
    if c.title.is_empty() {
        let first = if text.is_empty() {
            o.files.first().map(|f| f.name.clone()).unwrap_or_default()
        } else {
            text.clone()
        };
        c.title = first
            .lines()
            .next()
            .unwrap_or("")
            .trim_start_matches('@')
            .chars()
            .take(60)
            .collect();
    }
    let project = crate::projects::get(&c.project);
    // Folder and mode: the chat's, else the project's.
    c.folder = if !o.folder.is_empty() {
        o.folder.clone()
    } else if o.chat.is_none() {
        project
            .as_ref()
            .map(|p| p.folder.clone())
            .unwrap_or_default()
    } else {
        o.folder.clone()
    };
    c.mode = if o.mode.is_empty() {
        project
            .as_ref()
            .map(|p| p.mode.clone())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "read".into())
    } else {
        o.mode.clone()
    };
    c.skills = o.skills.clone();
    let prior = c.clone();
    let files = store_files(&c.id, &o.files);
    // Skills on: the project's plus the chat's.
    let mut skill_paths: Vec<String> = project
        .as_ref()
        .map(|p| p.skills.clone())
        .unwrap_or_default();
    for s in &o.skills {
        if !skill_paths.contains(s) {
            skill_paths.push(s.clone());
        }
    }
    let active: Vec<(String, String)> = skill_paths
        .iter()
        .filter_map(|p| crate::skills::content(p))
        .collect();
    let latest = Msg {
        role: "user".into(),
        text: text.clone(),
        ts: now(),
        files,
        agent: o.agent.clone(),
        skills: active.iter().map(|(n, _)| n.clone()).collect(),
        ..Default::default()
    };
    if o.agent.is_empty() {
        c.model = o.model.clone();
        c.tools = o.tools.clone();
    }
    c.updated = now();
    c.messages.push(latest.clone());
    save(&c);
    let id = c.id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    running()
        .lock()
        .unwrap()
        .insert(id.clone(), (cancel.clone(), None));
    let model = o.model.clone();
    let tools = o.tools.clone();
    let agent = o.agent.clone();
    let client = o.client.clone();
    std::thread::spawn(move || {
        let mut run = Run {
            app,
            chat: c.id.clone(),
            cancel,
            text: String::new(),
            thinking: String::new(),
            tools: Vec::new(),
            tool_ids: Vec::new(),
        };
        let (kind, name) = model.split_once(':').unwrap_or((model.as_str(), ""));
        let prompt = transcript(&prior, &latest);
        let res = if !agent.is_empty() {
            run_opencue(&mut run, &agent, &prompt)
        } else {
            let can = runner_tools(kind);
            // Folders the model may read.
            let mut roots: Vec<String> = Vec::new();
            if !c.folder.is_empty() {
                roots.push(crate::paths::expand(&c.folder));
            }
            let has_files = c.messages.iter().any(|m| !m.files.is_empty());
            let att_dir = has_files.then(|| files_dir(&c.id).to_string_lossy().into_owned());
            if let Some(d) = &att_dir {
                roots.push(d.clone());
            }
            let catalog = if can {
                crate::skills::list(Some(&c.folder))
            } else {
                Vec::new()
            };
            for k in &catalog {
                if let Some(d) = Path::new(&k.path).parent().and_then(|d| d.parent()) {
                    let d = d.to_string_lossy().into_owned();
                    if !roots.contains(&d) {
                        roots.push(d);
                    }
                }
            }
            let fs_access = can && !roots.is_empty();
            if !fs_access {
                roots.clear();
            }
            let knowledge: Vec<(String, String)> = project
                .as_ref()
                .map(|p| {
                    p.files
                        .iter()
                        .filter(|f| kind_of(Path::new(&f.path)) == "text")
                        .filter_map(|f| read_text(&f.path, 60_000).map(|t| (f.name.clone(), t)))
                        .collect()
                })
                .unwrap_or_default();
            let agents: Vec<String> = crate::mcp::opencue_agents()
                .into_iter()
                .map(|a| a.name)
                .collect();
            let tools_on = if can { tools.clone() } else { Vec::new() };
            let system = crate::prompt::build(&crate::prompt::Ctx {
                runner: kind,
                model: name,
                tools: &tools_on,
                project: project.as_ref(),
                folder: &c.folder,
                mode: &c.mode,
                fs_access,
                attachments_dir: att_dir,
                active_skills: &active,
                catalog: &catalog,
                knowledge: &knowledge,
                agents: &agents,
                client: &client,
            });
            let job = Job {
                kind: kind.to_string(),
                model: name.to_string(),
                tools: tools_on,
                system,
                prompt,
                prior,
                latest,
                folder: crate::paths::expand(&c.folder),
                mode: c.mode.clone(),
                roots,
            };
            match job.kind.as_str() {
                "claude" => run_claude(&mut run, &job),
                "codex" => run_codex(&mut run, &job),
                "gemini" => run_gemini(&mut run, &job),
                "ollama" => run_ollama(&mut run, &job),
                "opencue" => run_opencue(&mut run, &job.model, &job.prompt),
                _ => Err(anyhow::anyhow!("Elegí un modelo")),
            }
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
                model: if agent.is_empty() {
                    model.clone()
                } else {
                    format!("opencue:{agent}")
                },
                tools: run.tools.clone(),
                error,
                thinking: run.thinking.clone(),
                agent: agent.clone(),
                ..Default::default()
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

// ---------- artifacts ----------

fn artifacts_dir() -> PathBuf {
    let d = crate::paths::ws_dir().join("artifacts");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Stores an HTML artifact so the `wsart:` protocol can serve it in a sandboxed frame.
pub fn artifact_put(html: &str) -> anyhow::Result<String> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    html.hash(&mut h);
    let key = format!("{:016x}", h.finish());
    let p = artifacts_dir().join(format!("{key}.html"));
    if !p.exists() {
        std::fs::write(&p, html)?;
    }
    Ok(key)
}

pub fn artifact_get(key: &str) -> Option<Vec<u8>> {
    let k: String = key.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if k.is_empty() {
        return None;
    }
    std::fs::read(artifacts_dir().join(format!("{k}.html"))).ok()
}

/// Writes an artifact to a file the system can open (browser, editor).
pub fn artifact_export(name: &str, content: &str) -> anyhow::Result<PathBuf> {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let d = artifacts_dir().join("export");
    std::fs::create_dir_all(&d)?;
    let p = d.join(if clean.is_empty() {
        "artifact.txt".to_string()
    } else {
        clean
    });
    std::fs::write(&p, content)?;
    Ok(p)
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

    #[test]
    fn file_tools_stay_inside_their_folders() {
        let root = std::env::temp_dir().join(format!("ws-fs-{}", now()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub").join("a.txt"), "hola\nmundo").unwrap();
        let roots = vec![root.to_string_lossy().into_owned()];
        let base = roots[0].clone();
        let (out, ok) = fs_call(&roots, &base, "fs__read", &json!({"path": "sub/a.txt"}));
        assert!(ok && out.contains("mundo"));
        let (out, ok) = fs_call(&roots, &base, "fs__search", &json!({"text": "MUNDO"}));
        assert!(ok && out.contains("a.txt:2"));
        let (_, ok) = fs_call(
            &roots,
            &base,
            "fs__read",
            &json!({"path": "../../etc/passwd"}),
        );
        assert!(!ok);
        let (out, _) = fs_call(&roots, &base, "fs__list", &json!({"path": "."}));
        assert_eq!(out, "sub/");
        assert_eq!(kind_of(&root.join("sub").join("a.txt")), "text");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn claude_gets_edit_tools_only_when_editing() {
        assert!(claude_tools(false, false).is_empty());
        assert_eq!(claude_tools(true, false), vec!["Read", "Glob", "Grep"]);
        assert!(claude_tools(true, true).contains(&"Edit"));
        assert_eq!(input_detail(&json!({"file_path": "src/a.rs"})), "src/a.rs");
        assert_eq!(input_detail(&json!({"query": "tauri"})), "tauri");
    }
}
