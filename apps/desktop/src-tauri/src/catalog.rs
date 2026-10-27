//! The apps WorkStudio knows. The three of the family ship inside the binary
//! (`catalog/apps.json`); anything the user adds lives in `~/.workstudio/apps.json` and wins by id.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const BUILTIN: &str = include_str!("../../../../catalog/apps.json");

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Cmds {
    pub unix: String,
    pub windows: String,
}

impl Cmds {
    pub fn here(&self) -> &str {
        if cfg!(windows) {
            &self.windows
        } else {
            &self.unix
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Health {
    pub url: String,
    pub contains: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct VersionSrc {
    pub file: String,
    pub cmd: String,
    pub json_url: String,
    pub field: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct StopDef {
    pub url: String,
    pub header: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct McpDef {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: String,
    pub needs: String,
    pub description: String,
    pub description_en: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct AppDef {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub color: String,
    pub icon: String,
    pub repo: String,
    pub site: String,
    /// "web" (local web UI we can show inside WorkStudio), "native" (its own desktop app) or "cli"
    pub kind: String,
    pub url: String,
    pub health: Option<Health>,
    pub home: String,
    pub cli: String,
    pub mac_app: String,
    pub process: String,
    pub version: Option<VersionSrc>,
    pub start: Cmds,
    pub stop: Option<StopDef>,
    pub install: Cmds,
    pub update: Cmds,
    pub mcp: Option<McpDef>,
    pub activity: String,
    pub features: Vec<String>,
    pub builtin: bool,
    pub tagline_en: String,
    pub description_en: String,
    /// macOS WebKit store of the app's own desktop window (its UI preferences live there).
    pub webstore: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct CliDef {
    pub id: String,
    pub name: String,
    pub bin: String,
    pub version: String,
    pub install: Cmds,
    pub update: Cmds,
    /// How the CLI takes MCP servers: "claude", "codex", "workspace" (project files) or "none".
    pub mcp: String,
    pub app: String,
    /// npm package, to look up its latest version.
    pub npm: String,
    pub builtin: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct CatalogFile {
    apps: Vec<AppDef>,
    clis: Vec<CliDef>,
}

fn user_file() -> std::path::PathBuf {
    crate::paths::ws_file("apps.json")
}

fn read_user() -> CatalogFile {
    std::fs::read_to_string(user_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn apps() -> Vec<AppDef> {
    let builtin: CatalogFile = serde_json::from_str(BUILTIN).expect("catalog/apps.json is valid");
    let mut out: Vec<AppDef> = builtin
        .apps
        .into_iter()
        .map(|mut a| {
            a.builtin = true;
            a
        })
        .collect();
    for a in read_user().apps {
        if a.id.is_empty() {
            continue;
        }
        if let Some(slot) = out.iter_mut().find(|b| b.id == a.id) {
            *slot = AppDef { builtin: true, ..a };
        } else {
            out.push(a);
        }
    }
    out
}

pub fn clis() -> Vec<CliDef> {
    let builtin: CatalogFile = serde_json::from_str(BUILTIN).expect("catalog/apps.json is valid");
    let mut out: Vec<CliDef> = builtin
        .clis
        .into_iter()
        .map(|mut c| {
            c.builtin = true;
            c
        })
        .collect();
    for c in read_user().clis {
        if c.id.is_empty() {
            continue;
        }
        if let Some(slot) = out.iter_mut().find(|b| b.id == c.id) {
            *slot = c;
        } else {
            out.push(c);
        }
    }
    out
}

pub fn get(id: &str) -> Option<AppDef> {
    apps().into_iter().find(|a| a.id == id)
}

fn clean_id(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Adds or replaces an app the user defined (or imported from a manifest).
pub fn save_user_app(mut app: AppDef) -> anyhow::Result<AppDef> {
    app.id = clean_id(if app.id.is_empty() {
        &app.name
    } else {
        &app.id
    });
    anyhow::ensure!(!app.id.is_empty(), "La app necesita un nombre");
    if app.kind.is_empty() {
        app.kind = if app.url.is_empty() {
            "cli".into()
        } else {
            "web".into()
        };
    }
    if app.health.is_none() && !app.url.is_empty() {
        app.health = Some(Health {
            url: app.url.clone(),
            contains: String::new(),
        });
    }
    app.builtin = false;
    let mut file = read_user();
    file.apps.retain(|a| a.id != app.id);
    file.apps.push(app.clone());
    crate::paths::write_atomic(&user_file(), &serde_json::to_string_pretty(&file)?)?;
    Ok(app)
}

pub fn remove_user_app(id: &str) -> anyhow::Result<()> {
    let mut file = read_user();
    file.apps.retain(|a| a.id != id);
    crate::paths::write_atomic(&user_file(), &serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

/// A manifest is the same JSON as one entry of `catalog/apps.json` (or a file with `apps: [...]`).
pub fn import_manifest(text: &str) -> anyhow::Result<Vec<AppDef>> {
    let value: serde_json::Value = serde_json::from_str(text)?;
    let list: Vec<AppDef> = if value.get("apps").is_some() {
        serde_json::from_value(value["apps"].clone())?
    } else {
        vec![serde_json::from_value(value)?]
    };
    list.into_iter().map(save_user_app).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn builtin_catalog_parses() {
        let apps = super::apps();
        assert!(apps.iter().any(|a| a.id == "brain"));
        assert!(apps.iter().any(|a| a.id == "opencue"));
        assert!(apps.iter().any(|a| a.id == "lumina"));
        assert!(super::clis().iter().any(|c| c.id == "claude"));
    }

    #[test]
    fn ids_are_clean() {
        assert_eq!(super::clean_id("  Mi App 2! "), "mi-app-2");
    }
}
