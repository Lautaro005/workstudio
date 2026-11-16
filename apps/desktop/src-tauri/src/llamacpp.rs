//! llama.cpp: `llama-server` speaks the OpenAI API and, when it starts without a model (router mode),
//! lists, loads, unloads, downloads and deletes models over HTTP — the same job Ollama does, with its
//! own web UI at the server's address. WorkStudio uses that API for the chat (`llamacpp:<model>`) and
//! for the "llama.cpp" card in Settings → Models. The server is found at the URL in the settings
//! (`llamacpp_url`) or, when empty, at the default ports of current (9931) and older (8080) builds.

use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

/// Where `llama-server` listens by default now, and by default in older builds.
const DEFAULT_PORTS: &[u16] = &[9931, 8080];

pub fn configured_url() -> String {
    crate::settings::load()
        .extra
        .get("llamacpp_url")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or_default()
}

fn api_key() -> String {
    crate::settings::load()
        .extra
        .get("llamacpp_key")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn agent(ms: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(ms.min(2000)))
        .timeout(Duration::from_millis(ms))
        .build()
}

fn with_key(req: ureq::Request) -> ureq::Request {
    let k = api_key();
    if k.is_empty() {
        req
    } else {
        req.set("Authorization", &format!("Bearer {k}"))
    }
}

fn get_json(url: &str, ms: u64) -> Option<Value> {
    with_key(agent(ms).get(url))
        .call()
        .ok()?
        .into_json::<Value>()
        .ok()
}

/// The server's base URL when something answers there (`/health` is public; `/v1/models` as a fallback).
pub fn find() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    let cfg = configured_url();
    if !cfg.is_empty() {
        candidates.push(cfg);
    }
    for p in DEFAULT_PORTS {
        candidates.push(format!("http://127.0.0.1:{p}"));
    }
    candidates.into_iter().find(|base| {
        agent(600)
            .get(&format!("{base}/health"))
            .call()
            .map(|r| r.status() < 500)
            .unwrap_or(false)
            || get_json(&format!("{base}/v1/models"), 800).is_some()
    })
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct LlModel {
    pub id: String,
    /// "loaded" | "unloaded" | "loading" | "sleeping" | "downloading" | … (router mode); "loaded" otherwise.
    pub status: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Status {
    pub url: String,
    pub up: bool,
    /// Started without a model: models can be loaded, unloaded, downloaded and deleted from here.
    pub router: bool,
    pub models: Vec<LlModel>,
    /// `llama-server` is installed (found in the PATH).
    pub installed: bool,
}

/// Reads the model list of `GET /models` (router) or `GET /v1/models` (a single model).
pub fn parse_models(models: Option<&Value>, v1: Option<&Value>) -> (bool, Vec<LlModel>) {
    if let Some(arr) = models.and_then(|v| v["data"].as_array()) {
        let router = arr.iter().any(|m| m.get("status").is_some());
        if router {
            let list = arr
                .iter()
                .filter_map(|m| {
                    Some(LlModel {
                        id: m["id"].as_str()?.to_string(),
                        status: m["status"]["value"]
                            .as_str()
                            .or_else(|| m["status"].as_str())
                            .unwrap_or("unloaded")
                            .to_string(),
                    })
                })
                .collect();
            return (true, list);
        }
    }
    let list = v1
        .and_then(|v| v["data"].as_array())
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    Some(LlModel {
                        id: m["id"].as_str()?.to_string(),
                        status: "loaded".into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    (false, list)
}

pub fn status() -> Status {
    crate::shellenv::extend_path();
    let installed = crate::shellenv::has("llama-server");
    match find() {
        Some(base) => status_at(&base, installed),
        None => Status {
            url: configured_url(),
            installed,
            ..Default::default()
        },
    }
}

fn status_at(base: &str, installed: bool) -> Status {
    let models = get_json(&format!("{base}/models"), 3000);
    let v1 = get_json(&format!("{base}/v1/models"), 3000);
    let (router, list) = parse_models(models.as_ref(), v1.as_ref());
    Status {
        url: base.to_string(),
        up: true,
        router,
        models: list,
        installed,
    }
}

/// Models the chat can use.
pub fn models() -> Vec<LlModel> {
    let Some(base) = find() else {
        return Vec::new();
    };
    let models = get_json(&format!("{base}/models"), 2500);
    let v1 = get_json(&format!("{base}/v1/models"), 2500);
    parse_models(models.as_ref(), v1.as_ref()).1
}

fn base_or_err() -> anyhow::Result<String> {
    find().ok_or_else(|| {
        anyhow::anyhow!(crate::settings::tr(
            "llama.cpp no está corriendo. Iniciá llama-server (sin indicar un modelo) y probá de nuevo.",
            "llama.cpp isn't running. Start llama-server (without a model) and try again."
        ))
    })
}

fn explain(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(code, r) => {
            let body = r.into_string().unwrap_or_default();
            if code == 404 {
                anyhow::anyhow!(crate::settings::tr(
                    "Este llama-server no está en modo router (se inició con un modelo): para cargar y descargar modelos desde acá, iniciá llama-server sin -m.",
                    "This llama-server isn't in router mode (it was started with a model): to load and unload models from here, start llama-server without -m."
                ))
            } else {
                anyhow::anyhow!("llama.cpp ({code}): {body}")
            }
        }
        other => anyhow::anyhow!("llama.cpp: {other}"),
    }
}

fn post_at(base: &str, path: &str, body: Value, ms: u64) -> anyhow::Result<()> {
    with_key(agent(ms).post(&format!("{base}{path}")))
        .send_json(body)
        .map_err(explain)?;
    Ok(())
}

fn post(path: &str, body: Value, ms: u64) -> anyhow::Result<()> {
    post_at(&base_or_err()?, path, body, ms)
}

/// Loading can take a while for a big model; the router answers when it is ready.
pub fn load(model: &str) -> anyhow::Result<()> {
    post("/models/load", json!({ "model": model }), 600_000)
}

pub fn unload(model: &str) -> anyhow::Result<()> {
    post("/models/unload", json!({ "model": model }), 60_000)
}

/// Starts a download (`user/repo:quant` from Hugging Face); the router keeps going in the background.
pub fn pull(model: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !model.trim().is_empty(),
        crate::settings::tr("Escribí el modelo", "Type the model")
    );
    post("/models", json!({ "model": model.trim() }), 30_000)
}

pub fn delete(model: &str) -> anyhow::Result<()> {
    delete_at(&base_or_err()?, model)
}

fn delete_at(base: &str, model: &str) -> anyhow::Result<()> {
    let enc: String = model
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    with_key(agent(30_000).delete(&format!("{base}/models?model={enc}")))
        .call()
        .map_err(explain)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// A tiny llama-server in router mode: answers the endpoints WorkStudio uses and records requests.
    fn fake_server() -> (String, Arc<Mutex<Vec<String>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in l.incoming() {
                let Ok(mut st) = stream else { break };
                // Read the headers and then the body, so the client never sees a reset.
                let mut data: Vec<u8> = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let n = st.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&data).to_string();
                    if let Some(h) = text.find("\r\n\r\n") {
                        let len = text[..h]
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if data.len() >= h + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&data).to_string();
                let line = req.lines().next().unwrap_or("").to_string();
                let body = if line.starts_with("GET /models") {
                    r#"{"data":[{"id":"a/gemma:Q4","status":{"value":"loaded"}},{"id":"b/qwen:Q4","status":{"value":"unloaded"}}]}"#
                } else if line.starts_with("GET /v1/models") {
                    r#"{"data":[{"id":"a/gemma:Q4"}]}"#
                } else {
                    r#"{"success":true}"#
                };
                seen.lock().unwrap().push(line);
                let _ = write!(
                    st,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        (base, log)
    }

    #[test]
    fn talks_to_a_router_server() {
        let (base, log) = fake_server();
        let st = status_at(&base, true);
        assert!(st.up && st.router && st.installed);
        assert_eq!(st.models.len(), 2);
        assert_eq!(st.models[1].status, "unloaded");
        post_at(&base, "/models/load", json!({"model": "b/qwen:Q4"}), 2000).unwrap();
        post_at(&base, "/models/unload", json!({"model": "b/qwen:Q4"}), 2000).unwrap();
        post_at(&base, "/models", json!({"model": "x/y:Q8"}), 2000).unwrap();
        delete_at(&base, "x/y:Q8").unwrap();
        let seen = log.lock().unwrap().clone();
        assert!(seen.iter().any(|l| l.starts_with("POST /models/load")));
        assert!(seen.iter().any(|l| l.starts_with("POST /models/unload")));
        assert!(seen.iter().any(|l| l.starts_with("POST /models ")));
        // The model id is URL-encoded in the query.
        assert!(seen
            .iter()
            .any(|l| l.starts_with("DELETE /models?model=x%2Fy%3AQ8")));
    }

    #[test]
    fn router_list_has_a_status_per_model() {
        let models = json!({"data": [
            {"id": "ggml-org/gemma-3-4b-it-GGUF:Q4_K_M", "status": {"value": "loaded", "args": []}},
            {"id": "qwen3:Q4", "status": {"value": "unloaded"}}
        ]});
        let (router, list) = parse_models(Some(&models), None);
        assert!(router);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].status, "loaded");
        assert_eq!(list[1].status, "unloaded");
    }

    #[test]
    fn single_model_server_lists_what_v1_says() {
        // Without a router `/models` can be missing or have no status.
        let v1 = json!({"object": "list", "data": [{"id": "../models/llama.gguf"}]});
        let (router, list) = parse_models(None, Some(&v1));
        assert!(!router);
        assert_eq!(
            list,
            vec![LlModel {
                id: "../models/llama.gguf".into(),
                status: "loaded".into()
            }]
        );
        let plain = json!({"data": [{"id": "m"}]});
        assert!(!parse_models(Some(&plain), Some(&plain)).0);
        assert!(parse_models(None, None).1.is_empty());
    }
}
