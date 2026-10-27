//! Real terminals (a pseudo-terminal per pane) streamed to xterm.js in the UI.

use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    gen: u64,
}

static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Deserialize, Debug, Default)]
#[serde(default)]
pub struct SpawnOpts {
    pub id: String,
    /// Empty = the user's shell.
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    /// Typed into the shell once it starts (so the command stays visible and the shell stays after it ends).
    pub initial: String,
}

#[derive(Serialize, Clone)]
struct DataEvent<'a> {
    id: &'a str,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
    code: Option<u32>,
}

pub fn spawn(app: AppHandle, opts: SpawnOpts) -> anyhow::Result<()> {
    anyhow::ensure!(!opts.id.is_empty(), "missing terminal id");
    kill(&opts.id);
    let pty = native_pty_system().openpty(PtySize {
        rows: opts.rows.max(5),
        cols: opts.cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let settings = crate::settings::load();
    let program = if !opts.program.is_empty() {
        opts.program.clone()
    } else if !settings.terminal_shell.is_empty() {
        settings.terminal_shell.clone()
    } else {
        crate::shellenv::user_shell()
    };
    let mut cmd = CommandBuilder::new(&program);
    if opts.program.is_empty() {
        #[cfg(not(windows))]
        cmd.arg("-l");
        #[cfg(windows)]
        cmd.arg("-NoLogo");
    }
    for a in &opts.args {
        cmd.arg(a);
    }
    let cwd = if opts.cwd.is_empty() {
        crate::paths::home()
    } else {
        crate::paths::expand_path(&opts.cwd)
    };
    cmd.cwd(if cwd.is_dir() {
        cwd
    } else {
        crate::paths::home()
    });
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "WorkStudio");
    cmd.env("WORKSTUDIO", "1");
    cmd.env(
        "WORKSTUDIO_MCP_CONFIG",
        crate::mcp::claude_config_path().to_string_lossy().as_ref(),
    );
    cmd.env(
        "WORKSTUDIO_WORKSPACE",
        crate::paths::workspace_dir().to_string_lossy().as_ref(),
    );
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    for (k, v) in &opts.env {
        cmd.env(k, v);
    }

    let mut child = pty.slave.spawn_command(cmd)?;
    drop(pty.slave);
    let killer = child.clone_killer();
    let mut reader = pty.master.try_clone_reader()?;
    let mut writer = pty.master.take_writer()?;
    if !opts.initial.is_empty() {
        let line = if cfg!(windows) {
            format!("{}\r\n", opts.initial)
        } else {
            format!("{}\r", opts.initial)
        };
        let _ = writer.write_all(line.as_bytes());
    }
    let gen = GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    sessions().lock().unwrap().insert(
        opts.id.clone(),
        Session {
            writer,
            master: pty.master,
            killer,
            gen,
        },
    );

    let id = opts.id.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let b64 = base64::engine::general_purpose::STANDARD;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app2.emit(
                        "pty-data",
                        DataEvent {
                            id: &id,
                            data: b64.encode(&buf[..n]),
                        },
                    );
                }
            }
        }
    });
    let id = opts.id;
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let current = {
            let mut map = sessions().lock().unwrap();
            if map.get(&id).map(|s| s.gen) == Some(gen) {
                map.remove(&id);
                true
            } else {
                false
            }
        };
        // A pane that was restarted already has a new session under the same id: stay quiet.
        if current {
            let _ = app.emit("pty-exit", ExitEvent { id, code });
        }
    });
    Ok(())
}

pub fn write(id: &str, data: &str) -> anyhow::Result<()> {
    let mut map = sessions().lock().unwrap();
    let s = map
        .get_mut(id)
        .ok_or_else(|| anyhow::anyhow!("terminal closed"))?;
    s.writer.write_all(data.as_bytes())?;
    s.writer.flush()?;
    Ok(())
}

pub fn resize(id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
    let map = sessions().lock().unwrap();
    if let Some(s) = map.get(id) {
        s.master.resize(PtySize {
            rows: rows.max(5),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })?;
    }
    Ok(())
}

pub fn kill(id: &str) {
    if let Some(mut s) = sessions().lock().unwrap().remove(id) {
        let _ = s.killer.kill();
    }
}

pub fn kill_all() {
    let ids: Vec<String> = sessions().lock().unwrap().keys().cloned().collect();
    for id in ids {
        kill(&id);
    }
}

pub fn alive() -> Vec<String> {
    sessions().lock().unwrap().keys().cloned().collect()
}
