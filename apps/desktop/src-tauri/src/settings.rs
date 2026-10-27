//! `~/.workstudio/settings.json`. Unknown keys are kept, so newer versions never lose older settings.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub user_name: String,
    /// "system" | "light" | "dark"
    pub theme: String,
    pub system_notifications: bool,
    /// app id -> notifications on/off (missing = on)
    pub notify_apps: BTreeMap<String, bool>,
    pub auto_check_updates: bool,
    pub update_interval_hours: u64,
    /// Apps to start with WorkStudio (headless backends: brain, Lumina).
    pub autostart: Vec<String>,
    /// app id -> its MCP server is part of the shared config (missing = on)
    pub mcp_apps: BTreeMap<String, bool>,
    /// Agent of OpenCue whose tools are exposed by `opencue mcp-serve`.
    pub opencue_agent: String,
    pub terminal_font_size: u32,
    pub terminal_shell: String,
    pub close_to_tray: bool,
    pub onboarded: bool,
    /// "system" | "es" | "en"
    pub language: String,
    /// Apps that open on their own interface instead of the details page.
    pub open_in_app: Vec<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            user_name: String::new(),
            theme: "system".into(),
            system_notifications: true,
            notify_apps: BTreeMap::new(),
            auto_check_updates: true,
            update_interval_hours: 6,
            autostart: Vec::new(),
            mcp_apps: BTreeMap::new(),
            opencue_agent: String::new(),
            terminal_font_size: 13,
            terminal_shell: String::new(),
            close_to_tray: true,
            onboarded: false,
            language: "system".into(),
            open_in_app: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

pub fn load() -> Settings {
    let path = crate::paths::ws_file("settings.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(s: &Settings) -> anyhow::Result<()> {
    let path = crate::paths::ws_file("settings.json");
    crate::paths::write_atomic(&path, &serde_json::to_string_pretty(s)?)?;
    Ok(())
}

impl Settings {
    pub fn app_notifies(&self, id: &str) -> bool {
        *self.notify_apps.get(id).unwrap_or(&true)
    }
    pub fn app_in_mcp(&self, id: &str) -> bool {
        *self.mcp_apps.get(id).unwrap_or(&true)
    }
}

/// True when WorkStudio speaks English (setting, or the system language when it is "system").
pub fn english() -> bool {
    let s = load();
    match s.language.as_str() {
        "en" => true,
        "es" => false,
        _ => {
            static SYS: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
            *SYS.get_or_init(|| {
                let lang = std::env::var("LANG")
                    .or_else(|_| std::env::var("LC_ALL"))
                    .unwrap_or_default();
                let sys = if lang.is_empty() || lang.starts_with("C") {
                    system_lang()
                } else {
                    lang
                };
                !sys.to_lowercase().starts_with("es")
            })
        }
    }
}

#[cfg(target_os = "macos")]
fn system_lang() -> String {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).replace(['(', ')', '"', ' ', '\n'], ""))
        .and_then(|s| s.split(',').next().map(String::from))
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn system_lang() -> String {
    String::new()
}

/// Picks the Spanish or the English text.
pub fn tr<'a>(es: &'a str, en: &'a str) -> &'a str {
    if english() {
        en
    } else {
        es
    }
}
