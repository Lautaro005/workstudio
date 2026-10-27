//! Where WorkStudio keeps its files, plus `~` and `{placeholder}` expansion for catalog commands.

use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// `~/.workstudio`, or `WORKSTUDIO_HOME` when set (tests and portable installs).
pub fn ws_dir() -> PathBuf {
    if let Ok(p) = std::env::var("WORKSTUDIO_HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    home().join(".workstudio")
}

pub fn ws_file(name: &str) -> PathBuf {
    let dir = ws_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir.join(name)
}

pub fn logs_dir() -> PathBuf {
    let d = ws_dir().join("logs");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Folder the agent terminals start in: it holds the generated MCP configs for every CLI.
pub fn workspace_dir() -> PathBuf {
    let d = ws_dir().join("workspace");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Expands a leading `~` to the user's home.
pub fn expand(s: &str) -> String {
    if s == "~" {
        return home().to_string_lossy().into_owned();
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return home().join(rest).to_string_lossy().into_owned();
    }
    s.to_string()
}

pub fn expand_path(s: &str) -> PathBuf {
    PathBuf::from(expand(s))
}

/// The user's `~/Applications` (where the installers of the family put their apps) or `/Applications`.
pub fn find_mac_app(name: &str) -> Option<PathBuf> {
    if name.is_empty() || !cfg!(target_os = "macos") {
        return None;
    }
    [
        home().join("Applications").join(name),
        Path::new("/Applications").join(name),
    ]
    .into_iter()
    .find(|p| p.exists())
}

/// Writes atomically (temp file + rename) so a crash never leaves half a config behind.
pub fn write_atomic(path: &Path, data: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("ws-tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)
}
