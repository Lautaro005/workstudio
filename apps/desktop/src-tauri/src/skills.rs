//! Skills: folders with a `SKILL.md` (YAML frontmatter `name` + `description`, then instructions),
//! the same format Claude Code uses. WorkStudio reads `~/.workstudio/skills`, `~/.claude/skills`
//! and, when a chat has a working folder, its `.claude/skills` and `.workstudio/skills`.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// "workstudio" | "claude" | "folder"
    pub source: String,
    /// Path of the SKILL.md (the skill's id).
    pub path: String,
}

/// `name` and `description` from the frontmatter; the folder name when missing.
pub fn parse(text: &str, fallback: &str) -> (String, String, String) {
    let mut name = String::new();
    let mut desc = String::new();
    let mut body = text;
    let t = text.trim_start_matches('\u{feff}');
    if let Some(rest) = t.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let fm = &rest[..end];
            body = rest[end + 4..].trim_start_matches(['\r', '\n']);
            let mut key = String::new();
            for line in fm.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    if !k.starts_with(' ') && !k.starts_with('\t') {
                        key = k.trim().to_string();
                        let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                        match key.as_str() {
                            "name" => name = v,
                            "description" => desc = v,
                            _ => {}
                        }
                        continue;
                    }
                }
                // Folded multi-line description.
                if key == "description" && !line.trim().is_empty() {
                    if !desc.is_empty() && desc != ">" && desc != "|" {
                        desc.push(' ');
                    } else {
                        desc.clear();
                    }
                    desc.push_str(line.trim());
                }
            }
        }
    }
    if name.is_empty() {
        name = fallback.to_string();
    }
    (name, desc, body.to_string())
}

fn scan(root: &Path, source: &str, out: &mut Vec<Skill>) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    dirs.sort();
    for d in dirs {
        let md = d.join("SKILL.md");
        let Ok(text) = std::fs::read_to_string(&md) else {
            continue;
        };
        let folder = d
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (name, description, _) = parse(&text, &folder);
        let path = md.to_string_lossy().into_owned();
        if out.iter().any(|s| s.path == path) {
            continue;
        }
        out.push(Skill {
            name,
            description,
            source: source.into(),
            path,
        });
    }
}

pub fn ws_skills_dir() -> PathBuf {
    crate::paths::ws_dir().join("skills")
}

pub fn list(folder: Option<&str>) -> Vec<Skill> {
    let mut out = Vec::new();
    scan(&ws_skills_dir(), "workstudio", &mut out);
    scan(
        &crate::paths::home().join(".claude").join("skills"),
        "claude",
        &mut out,
    );
    if let Some(f) = folder.filter(|f| !f.is_empty()) {
        let f = crate::paths::expand_path(f);
        scan(&f.join(".claude").join("skills"), "folder", &mut out);
        scan(&f.join(".workstudio").join("skills"), "folder", &mut out);
    }
    out
}

/// The instructions of a skill (without its frontmatter). Only real SKILL.md files are read.
pub fn content(path: &str) -> Option<(String, String)> {
    let p = Path::new(path);
    if p.file_name().map(|n| n != "SKILL.md").unwrap_or(true) {
        return None;
    }
    let text = std::fs::read_to_string(p).ok()?;
    let folder = p
        .parent()
        .and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (name, _, body) = parse(&text, &folder);
    Some((name, body))
}

fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s
        .split('-')
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if s.is_empty() {
        "skill".into()
    } else {
        s
    }
}

/// Creates or replaces a skill in `~/.workstudio/skills/<slug>/SKILL.md`.
pub fn save(name: &str, description: &str, body: &str) -> anyhow::Result<Skill> {
    anyhow::ensure!(
        !name.trim().is_empty(),
        crate::settings::tr("Poné un nombre a la skill", "Give the skill a name")
    );
    let s = slug(name);
    let path = ws_skills_dir().join(&s).join("SKILL.md");
    let desc = description.replace('\n', " ");
    let text = format!(
        "---\nname: {s}\ndescription: {}\n---\n\n{}\n",
        desc.trim(),
        body.trim()
    );
    crate::paths::write_atomic(&path, &text)?;
    Ok(Skill {
        name: s,
        description: desc.trim().into(),
        source: "workstudio".into(),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Deletes a skill WorkStudio owns (only under `~/.workstudio/skills`).
pub fn delete(path: &str) -> anyhow::Result<()> {
    let p = PathBuf::from(path);
    let root = ws_skills_dir();
    anyhow::ensure!(
        p.starts_with(&root) && p.file_name().map(|n| n == "SKILL.md").unwrap_or(false),
        "Solo se pueden borrar las skills de WorkStudio"
    );
    if let Some(d) = p.parent() {
        std::fs::remove_dir_all(d)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frontmatter() {
        let (n, d, b) = parse(
            "---\nname: pdf\ndescription: \"Read and fill PDFs\"\n---\n\n# Steps\nDo it.",
            "x",
        );
        assert_eq!(n, "pdf");
        assert_eq!(d, "Read and fill PDFs");
        assert!(b.starts_with("# Steps"));
        let (n, d, _) = parse(
            "---\ndescription: >\n  Long text\n  on two lines\n---\nbody",
            "folder",
        );
        assert_eq!(n, "folder");
        assert_eq!(d, "Long text on two lines");
        let (n, _, b) = parse("no frontmatter", "f");
        assert_eq!((n.as_str(), b.as_str()), ("f", "no frontmatter"));
        assert_eq!(slug("My Skill!"), "my-skill");
    }
}
