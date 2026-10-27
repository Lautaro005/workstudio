//! Apps opened from the Dock or Finder get a bare PATH (`/usr/bin:/bin`), so `brain`, `lumina`,
//! `claude` or `npm` would not be found. We ask the user's login shell for its PATH once at startup.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn user_shell() -> String {
    #[cfg(windows)]
    {
        if which::which("pwsh").is_ok() {
            return "pwsh.exe".into();
        }
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            })
    }
}

#[cfg(not(windows))]
pub fn load_login_path() {
    let shell = user_shell();
    let child = Command::new(&shell)
        .args([
            "-l",
            "-i",
            "-c",
            "printf '__WSPATH__%s__WSPATH__' \"$PATH\"",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut extra: Vec<String> = Vec::new();
    if let Ok(mut child) = child {
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() > Duration::from_secs(4) => {
                    let _ = child.kill();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => break,
            }
        }
        if let Ok(out) = child.wait_with_output() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(p) = text.split("__WSPATH__").nth(1) {
                extra.extend(p.split(':').filter(|s| !s.is_empty()).map(String::from));
            }
        }
    }
    set_path(extra);
}

/// Adds the usual command folders to PATH without asking the shell (fast; used by `workstudio mcp`).
#[cfg(not(windows))]
pub fn extend_path() {
    set_path(Vec::new());
}

#[cfg(windows)]
pub fn extend_path() {
    load_login_path();
}

#[cfg(not(windows))]
fn set_path(mut extra: Vec<String>) {
    // Where the installers of the family and the usual tool managers put commands.
    let home = crate::paths::home();
    for p in [
        ".local/bin",
        ".cargo/bin",
        ".bun/bin",
        ".npm-global/bin",
        ".volta/bin",
    ] {
        extra.push(home.join(p).to_string_lossy().into_owned());
    }
    for p in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        extra.push(p.into());
    }
    let current = std::env::var("PATH").unwrap_or_default();
    // The current PATH goes first so a caller's choices (an agent CLI's env) win.
    let mut all: Vec<String> = current
        .split(':')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let login_first = !extra.is_empty();
    if login_first {
        all = extra.into_iter().chain(all).collect();
    } else {
        all.extend(extra);
    }
    let mut seen = std::collections::HashSet::new();
    let merged: Vec<String> = all.into_iter().filter(|p| seen.insert(p.clone())).collect();
    std::env::set_var("PATH", merged.join(":"));
}

#[cfg(windows)]
pub fn load_login_path() {
    let home = crate::paths::home();
    let current = std::env::var("PATH").unwrap_or_default();
    let local = home.join(".local").join("bin");
    std::env::set_var("PATH", format!("{};{}", local.to_string_lossy(), current));
}

/// Runs a one-line command through the shell and returns trimmed stdout (with a time limit).
pub fn capture(cmd: &str, timeout: Duration) -> Option<String> {
    #[cfg(windows)]
    let mut c = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", cmd]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", cmd]);
        c
    };
    let mut child = c
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Starts a command in the background, detached from WorkStudio, logging to `~/.workstudio/logs/<id>.log`.
pub fn spawn_detached(id: &str, cmd: &str) -> anyhow::Result<()> {
    let log = crate::paths::logs_dir().join(format!("{id}.log"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let log = log.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','{} *>> ''{}''' ",
            cmd.replace('\'', "''"),
            log
        );
        Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .spawn()?;
    }
    #[cfg(not(windows))]
    {
        let line = format!(
            "nohup {cmd} >> '{}' 2>&1 &",
            log.to_string_lossy().replace('\'', "'\\''")
        );
        Command::new("/bin/sh")
            .args(["-c", &line])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?
            .wait()?;
    }
    Ok(())
}

pub fn has(bin: &str) -> bool {
    !bin.is_empty() && which::which(bin).is_ok()
}
