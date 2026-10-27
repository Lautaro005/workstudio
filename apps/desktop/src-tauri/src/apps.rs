//! Installed? Running? Which version? Start, stop and open each app of the catalog.

use crate::catalog::AppDef;
use crate::shellenv;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct AppStatus {
    pub id: String,
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    /// Something that tells where it is installed (folder, .app or command path).
    pub location: Option<String>,
}

fn http_agent(timeout_ms: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(timeout_ms))
        .timeout(Duration::from_millis(timeout_ms * 3))
        .build()
}

pub fn http_get_text(url: &str, timeout_ms: u64) -> Option<String> {
    let resp = http_agent(timeout_ms).get(url).call().ok()?;
    let mut body = String::new();
    use std::io::Read;
    resp.into_reader()
        .take(2_000_000)
        .read_to_string(&mut body)
        .ok()?;
    Some(body)
}

pub fn http_get_json(url: &str, timeout_ms: u64) -> Option<serde_json::Value> {
    serde_json::from_str(&http_get_text(url, timeout_ms)?).ok()
}

fn healthy(app: &AppDef) -> bool {
    match &app.health {
        Some(h) if !h.url.is_empty() => match http_get_text(&h.url, 700) {
            Some(body) => h.contains.is_empty() || body.contains(&h.contains),
            None => false,
        },
        _ => false,
    }
}

pub fn process_running(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    #[cfg(windows)]
    {
        let exe = if name.ends_with(".exe") {
            name.to_string()
        } else {
            format!("{name}.exe")
        };
        shellenv::capture(
            &format!(
                "Get-Process -Name '{}' -ErrorAction SilentlyContinue | Select -First 1 -Expand Id",
                exe.trim_end_matches(".exe")
            ),
            Duration::from_secs(3),
        )
        .is_some()
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("pgrep")
            .args(["-x", name])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

fn location(app: &AppDef) -> Option<String> {
    if let Some(p) = crate::paths::find_mac_app(&app.mac_app) {
        return Some(p.to_string_lossy().into_owned());
    }
    if !app.home.is_empty() {
        let p = crate::paths::expand_path(&app.home);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    if !app.cli.is_empty() {
        if let Ok(p) = which::which(&app.cli) {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

fn version(app: &AppDef, running: bool) -> Option<String> {
    let src = app.version.as_ref()?;
    if running && !src.json_url.is_empty() {
        if let Some(v) = http_get_json(&src.json_url, 900) {
            if let Some(s) = v.get(&src.field).and_then(|x| x.as_str()) {
                return Some(s.to_string());
            }
        }
    }
    if !src.file.is_empty() {
        if let Ok(s) = std::fs::read_to_string(crate::paths::expand(&src.file)) {
            let s = s.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    if !src.cmd.is_empty() {
        let bin = src.cmd.split_whitespace().next().unwrap_or("");
        if shellenv::has(bin) {
            if let Some(out) = shellenv::capture(&src.cmd, Duration::from_secs(5)) {
                // "opencue 0.5.2" → "0.5.2"
                let last = out
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .last()
                    .unwrap_or("")
                    .to_string();
                if !last.is_empty() {
                    return Some(last);
                }
            }
        }
    }
    None
}

pub fn status(app: &AppDef, with_version: bool) -> AppStatus {
    let location = location(app);
    let running = match app.kind.as_str() {
        "native" => process_running(&app.process),
        _ => healthy(app) || (app.health.is_none() && process_running(&app.process)),
    };
    let installed = location.is_some() || running;
    AppStatus {
        id: app.id.clone(),
        installed,
        running,
        version: if with_version && installed {
            version(app, running)
        } else {
            None
        },
        location,
    }
}

pub fn start(app: &AppDef) -> anyhow::Result<()> {
    if app.kind == "native" {
        return open_native(app);
    }
    let cmd = app.start.here();
    anyhow::ensure!(
        !cmd.is_empty(),
        "{} no tiene un comando para iniciar",
        app.name
    );
    let bin = cmd.split_whitespace().next().unwrap_or("");
    anyhow::ensure!(
        shellenv::has(bin),
        "No encuentro el comando «{bin}». ¿Está instalado {}?",
        app.name
    );
    shellenv::spawn_detached(&app.id, cmd)
}

pub fn stop(app: &AppDef) -> anyhow::Result<()> {
    if let Some(stop) = &app.stop {
        if !stop.url.is_empty() {
            let mut req = http_agent(1500).post(&stop.url);
            if !stop.header.is_empty() {
                req = req.set(&stop.header, &stop.value);
            }
            req.set("Content-Type", "application/json")
                .send_string("{}")
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            return Ok(());
        }
    }
    anyhow::ensure!(!app.process.is_empty(), "No sé cómo cerrar {}", app.name);
    #[cfg(windows)]
    shellenv::capture(
        &format!(
            "Stop-Process -Name '{}' -ErrorAction SilentlyContinue; 'ok'",
            app.process
        ),
        Duration::from_secs(5),
    );
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-x", &app.process])
            .status();
    }
    Ok(())
}

/// Opens an app in its own window: the .app on macOS, otherwise its command.
pub fn open_native(app: &AppDef) -> anyhow::Result<()> {
    if let Some(p) = crate::paths::find_mac_app(&app.mac_app) {
        std::process::Command::new("open").arg(p).spawn()?;
        return Ok(());
    }
    let cmd = app.start.here();
    let bin = if app.cli.is_empty() {
        cmd.split_whitespace().next().unwrap_or("")
    } else {
        &app.cli
    };
    anyhow::ensure!(shellenv::has(bin), "{} no está instalado", app.name);
    shellenv::spawn_detached(&app.id, if cmd.is_empty() { bin } else { cmd })
}
