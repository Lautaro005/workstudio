//! Chat projects, like Claude's: a name, instructions every chat of the project gets, a working
//! folder, knowledge files, skills that are always on, and a default model and tools.
//! `~/.workstudio/projects/<id>.json`, files in `~/.workstudio/projects/<id>/files/`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct ProjectFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Added to the system prompt of every chat in the project.
    pub instructions: String,
    /// Working folder the agents run in ("" = none).
    pub folder: String,
    /// "read" | "edit": what the agents may do in the folder.
    pub mode: String,
    /// Default model for new chats ("" = the last one used).
    pub model: String,
    /// Default pills (brain, lumina, web).
    pub tools: Vec<String>,
    /// SKILL.md paths that are always on.
    pub skills: Vec<String>,
    /// Knowledge files: their text goes with every message.
    pub files: Vec<ProjectFile>,
    pub created: u64,
    pub updated: u64,
}

fn dir() -> PathBuf {
    let d = crate::paths::ws_dir().join("projects");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn safe(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

fn file_of(id: &str) -> PathBuf {
    dir().join(format!("{}.json", safe(id)))
}

fn files_dir(id: &str) -> PathBuf {
    dir().join(safe(id)).join("files")
}

pub fn get(id: &str) -> Option<Project> {
    if id.is_empty() {
        return None;
    }
    std::fs::read_to_string(file_of(id))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn list() -> Vec<Project> {
    let mut out: Vec<Project> = std::fs::read_dir(dir())
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
                .filter_map(|e| std::fs::read_to_string(e.path()).ok())
                .filter_map(|s| serde_json::from_str::<Project>(&s).ok())
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|p| std::cmp::Reverse(p.updated));
    out
}

pub fn save(mut p: Project) -> anyhow::Result<Project> {
    anyhow::ensure!(
        !p.name.trim().is_empty(),
        crate::settings::tr("Poné un nombre al proyecto", "Give the project a name")
    );
    let now = crate::chat::now();
    if p.id.is_empty() {
        p.id = format!("p{now:x}");
        p.created = now;
    }
    if p.mode.is_empty() {
        p.mode = "read".into();
    }
    // Files are managed by add_files / remove_file: keep what is on disk.
    if let Some(old) = get(&p.id) {
        p.files = old.files;
        if p.created == 0 {
            p.created = old.created;
        }
    }
    p.name = p.name.trim().to_string();
    p.updated = now;
    crate::paths::write_atomic(&file_of(&p.id), &serde_json::to_string_pretty(&p)?)?;
    Ok(p)
}

pub fn delete(id: &str) {
    let _ = std::fs::remove_file(file_of(id));
    let _ = std::fs::remove_dir_all(dir().join(safe(id)));
}

/// Copies files into the project. A file with the same name is replaced.
pub fn add_files(id: &str, paths: &[String]) -> anyhow::Result<Project> {
    let mut p = get(id).ok_or_else(|| anyhow::anyhow!("No encontré el proyecto"))?;
    let fd = files_dir(id);
    std::fs::create_dir_all(&fd)?;
    for src in paths {
        let src = Path::new(src);
        if !src.is_file() {
            continue;
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".into());
        let dest = fd.join(&name);
        std::fs::copy(src, &dest)?;
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        p.files.retain(|f| f.name != name);
        p.files.push(ProjectFile {
            name,
            path: dest.to_string_lossy().into_owned(),
            size,
        });
    }
    p.updated = crate::chat::now();
    crate::paths::write_atomic(&file_of(id), &serde_json::to_string_pretty(&p)?)?;
    Ok(p)
}

pub fn remove_file(id: &str, name: &str) -> anyhow::Result<Project> {
    let mut p = get(id).ok_or_else(|| anyhow::anyhow!("No encontré el proyecto"))?;
    if let Some(f) = p.files.iter().find(|f| f.name == name) {
        let _ = std::fs::remove_file(&f.path);
    }
    p.files.retain(|f| f.name != name);
    p.updated = crate::chat::now();
    crate::paths::write_atomic(&file_of(id), &serde_json::to_string_pretty(&p)?)?;
    Ok(p)
}
