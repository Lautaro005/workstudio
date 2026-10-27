//! One MCP server for every agent: `workstudio mcp` starts the servers of the user's apps (brain,
//! Lumina, OpenCue and the ones added by hand), merges their tools under one name and routes each call
//! to the server it came from. Agents see a single server instead of a long list.
//!
//! Tools are exposed as `<server>__<tool>` (brain and OpenCue both have `read_file`, for example).
//! `--only brain,lumina,web` limits the hub to some servers; `web` adds WorkStudio's own web tools.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const PROTOCOL: &str = "2025-06-18";

/// A running MCP server we talk to over stdio.
pub struct McpChild {
    pub name: String,
    proc: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    next: AtomicU64,
    pub instructions: String,
    pub tools: Vec<Value>,
}

impl Drop for McpChild {
    fn drop(&mut self) {
        if let Ok(mut p) = self.proc.lock() {
            let _ = p.kill();
            let _ = p.wait();
        }
    }
}

fn write_line(w: &Mutex<ChildStdin>, msg: &Value) -> std::io::Result<()> {
    let mut w = w.lock().unwrap();
    writeln!(w, "{msg}")?;
    w.flush()
}

impl McpChild {
    pub fn start(s: &crate::mcp::Server, timeout: Duration) -> anyhow::Result<McpChild> {
        anyhow::ensure!(!s.is_http(), "{}: HTTP servers are not proxied", s.name);
        let log = crate::paths::logs_dir().join(format!("mcp-{}.log", s.name));
        let err = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log)
            .map(Stdio::from)
            .unwrap_or_else(|_| Stdio::null());
        let mut cmd = Command::new(&s.command);
        cmd.args(&s.args)
            .envs(&s.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(err);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut proc = cmd.spawn()?;
        let stdin = Arc::new(Mutex::new(
            proc.stdin
                .take()
                .ok_or_else(|| anyhow::anyhow!("no stdin"))?,
        ));
        let stdout = proc
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let pending: Arc<Mutex<HashMap<u64, Sender<Value>>>> = Arc::default();
        {
            let pending = pending.clone();
            let stdin = stdin.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
                        continue;
                    };
                    match (msg.get("id"), msg.get("method").and_then(|m| m.as_str())) {
                        // An answer to one of our requests.
                        (Some(id), None) => {
                            if let Some(tx) = id
                                .as_u64()
                                .and_then(|id| pending.lock().unwrap().remove(&id))
                            {
                                let _ = tx.send(msg);
                            }
                        }
                        // A request from the server.
                        (Some(id), Some(method)) => {
                            let reply = match method {
                                "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
                                "roots/list" => {
                                    json!({"jsonrpc": "2.0", "id": id, "result": {"roots": []}})
                                }
                                _ => {
                                    json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "not supported by WorkStudio"}})
                                }
                            };
                            let _ = write_line(&stdin, &reply);
                        }
                        _ => {}
                    }
                }
                // The server is gone: dropping the senders wakes every waiting call.
                pending.lock().unwrap().clear();
            });
        }
        let mut child = McpChild {
            name: s.name.clone(),
            proc: Mutex::new(proc),
            stdin,
            pending,
            next: AtomicU64::new(1),
            instructions: String::new(),
            tools: Vec::new(),
        };
        let init = child.request(
            "initialize",
            json!({"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "ai-workstudio", "version": env!("CARGO_PKG_VERSION")}}),
            timeout,
        )?;
        child.instructions = init
            .get("instructions")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        child.notify("notifications/initialized", json!({}))?;
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let r = child.request("tools/list", params, timeout)?;
            if let Some(list) = r.get("tools").and_then(|t| t.as_array()) {
                child.tools.extend(list.iter().cloned());
            }
            cursor = r
                .get("nextCursor")
                .and_then(|c| c.as_str())
                .map(String::from);
            if cursor.is_none() {
                break;
            }
        }
        Ok(child)
    }

    fn notify(&self, method: &str, params: Value) -> anyhow::Result<()> {
        write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        )?;
        Ok(())
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> anyhow::Result<Value> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(id, tx);
        write_line(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
        )?;
        match rx.recv_timeout(timeout) {
            Ok(msg) => {
                if let Some(err) = msg.get("error") {
                    anyhow::bail!(
                        "{}: {}",
                        self.name,
                        err.get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("error")
                    );
                }
                Ok(msg.get("result").cloned().unwrap_or(json!({})))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                anyhow::bail!("{}: no answer to {method}", self.name)
            }
            Err(_) => anyhow::bail!("{}: the server closed", self.name),
        }
    }

    pub fn call(&self, tool: &str, args: Value, timeout: Duration) -> anyhow::Result<Value> {
        self.request(
            "tools/call",
            json!({"name": tool, "arguments": args}),
            timeout,
        )
    }
}

/// Where an exposed tool goes.
enum Route {
    Child(usize, String),
    Web(&'static str),
}

pub struct Hub {
    children: Vec<McpChild>,
    routes: HashMap<String, Route>,
    pub tools: Vec<Value>,
    pub instructions: String,
    pub problems: Vec<String>,
}

fn exposed_name(server: &str, tool: &str, taken: &HashMap<String, Route>) -> String {
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    };
    let mut n = format!("{}__{}", clean(server), clean(tool));
    if n.len() > 64 {
        n.truncate(64);
    }
    let base = n.clone();
    let mut i = 2;
    while taken.contains_key(&n) {
        let suffix = format!("_{i}");
        n = format!("{}{}", &base[..base.len().min(64 - suffix.len())], suffix);
        i += 1;
    }
    n
}

impl Hub {
    /// Starts the selected servers in parallel. `only`: server names, plus "web" for the web tools.
    pub fn start(only: Option<&[String]>) -> Hub {
        let want = |name: &str| only.map(|o| o.iter().any(|x| x == name)).unwrap_or(true);
        let list: Vec<crate::mcp::Server> = crate::mcp::active()
            .into_iter()
            .filter(|s| !s.is_http() && want(&s.name))
            .collect();
        let handles: Vec<_> = list
            .into_iter()
            .map(|s| {
                std::thread::spawn(move || {
                    let r = McpChild::start(&s, Duration::from_secs(40));
                    (s.name.clone(), r)
                })
            })
            .collect();
        let mut hub = Hub {
            children: Vec::new(),
            routes: HashMap::new(),
            tools: Vec::new(),
            instructions: String::new(),
            problems: Vec::new(),
        };
        let mut parts = vec![
            "AI WorkStudio joins the tools of the user's apps in this one server. Each tool name starts with the app it belongs to: brain__* (the user's knowledge base and memory), lumina__* (meetings, transcripts and notes), opencue__* (the user's OpenCue agents) and web__* (web search and pages).".to_string(),
        ];
        for h in handles {
            let Ok((name, r)) = h.join() else { continue };
            match r {
                Ok(c) => {
                    let idx = hub.children.len();
                    for t in &c.tools {
                        let Some(orig) = t.get("name").and_then(|n| n.as_str()) else {
                            continue;
                        };
                        let exp = exposed_name(&c.name, orig, &hub.routes);
                        let mut t2 = t.clone();
                        t2["name"] = json!(exp);
                        let desc = t.get("description").and_then(|d| d.as_str()).unwrap_or("");
                        t2["description"] = json!(format!("[{}] {desc}", c.name));
                        hub.tools.push(t2);
                        hub.routes.insert(exp, Route::Child(idx, orig.to_string()));
                    }
                    if !c.instructions.trim().is_empty() {
                        parts.push(format!(
                            "## {} (tools {}__*)\n{}",
                            c.name,
                            c.name,
                            c.instructions.trim()
                        ));
                    }
                    hub.children.push(c);
                }
                Err(e) => hub.problems.push(format!("{name}: {e}")),
            }
        }
        if only.map(|o| o.iter().any(|x| x == "web")).unwrap_or(false) {
            for t in crate::web::tool_defs() {
                let name = t["name"].as_str().unwrap_or("").to_string();
                let route = if name == "web__search" {
                    Route::Web("search")
                } else {
                    Route::Web("fetch")
                };
                hub.routes.insert(name, route);
                hub.tools.push(t);
            }
        }
        hub.instructions = parts.join("\n\n");
        hub
    }

    /// Runs a tool and returns an MCP CallToolResult.
    pub fn call(&self, name: &str, args: Value) -> Value {
        let err = |m: String| json!({"content": [{"type": "text", "text": m}], "isError": true});
        match self.routes.get(name) {
            Some(Route::Child(i, orig)) => {
                match self.children[*i].call(orig, args, Duration::from_secs(900)) {
                    Ok(v) => v,
                    Err(e) => err(e.to_string()),
                }
            }
            Some(Route::Web(which)) => {
                let r = if *which == "search" {
                    crate::web::search(
                        args.get("query").and_then(|q| q.as_str()).unwrap_or(""),
                        args.get("max_results")
                            .and_then(|n| n.as_u64())
                            .unwrap_or(8) as usize,
                    )
                } else {
                    crate::web::fetch(
                        args.get("url").and_then(|q| q.as_str()).unwrap_or(""),
                        args.get("offset").and_then(|n| n.as_u64()).unwrap_or(0) as usize,
                    )
                };
                match r {
                    Ok(text) => json!({"content": [{"type": "text", "text": text}]}),
                    Err(e) => err(e.to_string()),
                }
            }
            None => err(format!("Unknown tool {name}")),
        }
    }
}

/// `workstudio mcp [--only a,b]`: the hub as an MCP server on stdin/stdout.
pub fn serve_stdio(args: &[String]) {
    crate::shellenv::extend_path();
    let only: Option<Vec<String>> = args
        .iter()
        .position(|a| a == "--only")
        .and_then(|i| args.get(i + 1))
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        });
    let hub = Arc::new(Hub::start(only.as_deref()));
    for p in &hub.problems {
        eprintln!("workstudio mcp: {p}");
    }
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let send = |out: &Arc<Mutex<std::io::Stdout>>, v: Value| {
        let mut o = out.lock().unwrap();
        let _ = writeln!(o, "{v}");
        let _ = o.flush();
    };
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let Some(id) = msg.get("id").cloned() else {
            continue; // notifications
        };
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        match method {
            "initialize" => {
                let version = params
                    .get("protocolVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or(PROTOCOL)
                    .to_string();
                send(
                    &out,
                    json!({"jsonrpc": "2.0", "id": id, "result": {
                        "protocolVersion": version,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {"name": "workstudio", "version": env!("CARGO_PKG_VERSION")},
                        "instructions": hub.instructions,
                    }}),
                );
            }
            "ping" => send(&out, json!({"jsonrpc": "2.0", "id": id, "result": {}})),
            "tools/list" => send(
                &out,
                json!({"jsonrpc": "2.0", "id": id, "result": {"tools": hub.tools}}),
            ),
            "tools/call" => {
                let hub = hub.clone();
                let out = out.clone();
                std::thread::spawn(move || {
                    let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let args = params.get("arguments").cloned().unwrap_or(json!({}));
                    let r = hub.call(name, args);
                    send(&out, json!({"jsonrpc": "2.0", "id": id, "result": r}));
                });
            }
            "resources/list" => send(
                &out,
                json!({"jsonrpc": "2.0", "id": id, "result": {"resources": []}}),
            ),
            "prompts/list" => send(
                &out,
                json!({"jsonrpc": "2.0", "id": id, "result": {"prompts": []}}),
            ),
            _ => send(
                &out,
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "method not found"}}),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_prefixed_and_unique() {
        let mut taken = HashMap::new();
        let a = exposed_name("brain", "read_file", &taken);
        assert_eq!(a, "brain__read_file");
        taken.insert(a, Route::Web("search"));
        assert_eq!(
            exposed_name("brain", "read_file", &taken),
            "brain__read_file_2"
        );
        let long = exposed_name("brain", &"x".repeat(80), &HashMap::new());
        assert!(long.len() <= 64);
    }
}
