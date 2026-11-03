//! Skills: folders with a `SKILL.md` (YAML frontmatter `name` + `description`, then instructions),
//! the same format Claude Code uses. WorkStudio gathers the skills of every tool the user has —
//! its own, OpenBlocks' built-in second-brain ones, Claude Code (and its plugins), Codex, Gemini,
//! OpenCue and brain — and tags each with a `group` so the chat can show them under titles.
//! When a chat has a working folder, that folder's `.claude/skills` and `.workstudio/skills` come too.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// "workstudio" | "builtin" | "claude" | "plugin" | "codex" | "gemini" | "opencue" | "brain" | "folder"
    pub source: String,
    /// Title the skill is listed under: "WorkStudio", "OpenBlocks", "Claude Code", "Codex"…
    pub group: String,
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

/// Display title of a source.
pub fn group_of(source: &str) -> &'static str {
    match source {
        "workstudio" => "WorkStudio",
        "builtin" => "OpenBlocks",
        "claude" => "Claude Code",
        "plugin" => "Claude Code · plugins",
        "codex" => "Codex",
        "gemini" => "Gemini",
        "opencue" => "OpenCue",
        "brain" => "brain",
        "openblocks" => "OpenBlocks",
        _ => "Carpeta",
    }
}

/// Order the groups appear in.
pub fn group_rank(group: &str) -> usize {
    [
        "WorkStudio",
        "OpenBlocks",
        "Claude Code",
        "Claude Code · plugins",
        "Codex",
        "Gemini",
        "OpenCue",
        "brain",
        "Carpeta",
    ]
    .iter()
    .position(|g| *g == group)
    .unwrap_or(99)
}

fn push(out: &mut Vec<Skill>, name: String, description: String, source: &str, path: String) {
    if out.iter().any(|s| s.path == path) {
        return;
    }
    out.push(Skill {
        name,
        description,
        source: source.into(),
        group: group_of(source).into(),
        path,
    });
}

/// Flat skills: `<root>/<name>.md` (brain keeps them like that, and OpenBlocks vaults may too).
fn scan_flat(root: &Path, source: &str, out: &mut Vec<Skill>) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().map(|e| e == "md").unwrap_or(false)
                && !p
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with('.'))
                    .unwrap_or(true)
        })
        .collect();
    files.sort();
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        let stem = f
            .file_stem()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (name, description, _) = parse(&text, &stem);
        push(
            out,
            name,
            description,
            source,
            f.to_string_lossy().into_owned(),
        );
    }
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
        push(
            out,
            name,
            description,
            source,
            md.to_string_lossy().into_owned(),
        );
    }
}

/// Every `skills` folder under `root` (plugins nest them: `cache/<market>/<plugin>/<version>/skills`).
fn find_skill_dirs(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let n = e.file_name().to_string_lossy().into_owned();
        if n == "node_modules" || n == ".git" {
            continue;
        }
        if n == "skills" {
            out.push(p);
        } else {
            find_skill_dirs(&p, depth - 1, out);
        }
    }
}

/// OpenCue's data folder (same places as `mcp.rs` looks for its database).
fn opencue_dir() -> PathBuf {
    if let Ok(h) = std::env::var("OPENCUE_HOME") {
        return PathBuf::from(h);
    }
    #[cfg(target_os = "macos")]
    return crate::paths::home().join("Library/Application Support/opencue");
    #[cfg(target_os = "windows")]
    return dirs::config_dir()
        .unwrap_or_default()
        .join("opencue")
        .join("data");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    return dirs::data_dir().unwrap_or_default().join("opencue");
}

/// brain's vault: `$BRAIN_HOME/vault` (default `~/.brain/vault`).
fn brain_vault() -> PathBuf {
    let home = std::env::var("BRAIN_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::paths::home().join(".brain"));
    let v = home.join("vault");
    if v.is_dir() {
        v
    } else {
        home
    }
}

/// The vault OpenBlocks opened last (`~/.openblocks/settings.json` → `last_vault`).
pub fn openblocks_vault() -> Option<PathBuf> {
    let home = std::env::var("OPENBLOCKS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::paths::home().join(".openblocks"));
    let text = std::fs::read_to_string(home.join("settings.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let p = PathBuf::from(v.get("last_vault")?.as_str()?);
    p.is_dir().then_some(p)
}

/// OpenBlocks' second-brain skills, adapted from Ben AI's "AI Second Brain Guide": they are written to
/// `~/.workstudio/builtin-skills/` so they are real SKILL.md files like any other.
const BUILTIN: &[(&str, &str, &str)] = &[
    (
        "second-brain-setup",
        "Set up a second brain in the OpenBlocks vault: brain dump, 5–10 context files, an AGENTS.md routing table and an index per folder",
        include_str!("../skills/second-brain-setup.md"),
    ),
    (
        "second-brain-operator",
        "Keep the second brain current: pick the best sources, save only insights and set up a daily automation that also retires stale notes",
        include_str!("../skills/second-brain-operator.md"),
    ),
    (
        "second-brain-optimizer",
        "Weekly health check of the second brain: AGENTS.md and indexes, links, duplicates, contradictions, long files, with a score out of 100",
        include_str!("../skills/second-brain-optimizer.md"),
    ),
];

fn builtin_dir() -> PathBuf {
    crate::paths::ws_dir().join("builtin-skills")
}

/// Writes the built-in skills when they are missing or changed (a new WorkStudio version).
fn ensure_builtin() {
    for (name, desc, body) in BUILTIN {
        let path = builtin_dir().join(name).join("SKILL.md");
        let text = format!(
            "---\nname: {name}\ndescription: {desc}\n---\n\n{}\n",
            body.trim()
        );
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            let _ = crate::paths::write_atomic(&path, &text);
        }
    }
}

pub fn ws_skills_dir() -> PathBuf {
    crate::paths::ws_dir().join("skills")
}

pub fn list(folder: Option<&str>) -> Vec<Skill> {
    ensure_builtin();
    let home = crate::paths::home();
    let mut out = Vec::new();
    scan(&ws_skills_dir(), "workstudio", &mut out);
    scan(&builtin_dir(), "builtin", &mut out);
    if let Some(v) = openblocks_vault() {
        scan(&v.join("skills"), "openblocks", &mut out);
        scan_flat(&v.join("skills"), "openblocks", &mut out);
    }
    scan(&home.join(".claude").join("skills"), "claude", &mut out);
    let mut plugin_dirs = Vec::new();
    find_skill_dirs(&home.join(".claude").join("plugins"), 8, &mut plugin_dirs);
    plugin_dirs.sort();
    for d in plugin_dirs {
        scan(&d, "plugin", &mut out);
    }
    let codex = std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".codex"));
    scan(&codex.join("skills"), "codex", &mut out);
    scan(&codex.join("skills").join(".system"), "codex", &mut out);
    scan(&home.join(".agents").join("skills"), "codex", &mut out);
    scan(&home.join(".gemini").join("skills"), "gemini", &mut out);
    scan(&opencue_dir().join("skills"), "opencue", &mut out);
    let bv = brain_vault();
    scan(&bv.join("skills"), "brain", &mut out);
    scan_flat(&bv.join("skills"), "brain", &mut out);
    if let Some(f) = folder.filter(|f| !f.is_empty()) {
        let f = crate::paths::expand_path(f);
        scan(&f.join(".claude").join("skills"), "folder", &mut out);
        scan(&f.join(".workstudio").join("skills"), "folder", &mut out);
    }
    // Same-named skills of different tools stay (they live under different titles); order by title.
    out.sort_by_key(|s| group_rank(&s.group));
    out
}

/// The instructions of a skill (without its frontmatter). Only real SKILL.md files are read.
pub fn content(path: &str) -> Option<(String, String)> {
    let p = Path::new(path);
    let flat = p.extension().map(|e| e == "md").unwrap_or(false)
        && p.parent()
            .and_then(|d| d.file_name())
            .map(|n| n == "skills")
            .unwrap_or(false);
    if p.file_name().map(|n| n != "SKILL.md").unwrap_or(true) && !flat {
        return None;
    }
    let text = std::fs::read_to_string(p).ok()?;
    let folder = if flat {
        p.file_stem()
    } else {
        p.parent().and_then(|d| d.file_name())
    }
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
        group: group_of("workstudio").into(),
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

    fn mk(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Skills of every tool show up, tagged with the title they are listed under.
    #[test]
    fn finds_the_skills_of_every_tool() {
        let t = std::env::temp_dir().join(format!("ws-skills-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        let sk = |name: &str, d: &str| format!("---\nname: {name}\ndescription: {d}\n---\nbody");
        mk(&t.join(".claude/skills/pdf/SKILL.md"), &sk("pdf", "PDFs"));
        mk(
            &t.join(".claude/plugins/cache/m/design/1.0/skills/ux/SKILL.md"),
            &sk("ux", "UX"),
        );
        mk(
            &t.join(".codex/skills/review/SKILL.md"),
            &sk("review", "Review"),
        );
        mk(&t.join(".gemini/skills/plan/SKILL.md"), &sk("plan", "Plan"));
        mk(&t.join("oc/skills/mail/SKILL.md"), &sk("mail", "Mail"));
        mk(
            &t.join("brain/vault/skills/notas.md"),
            &sk("notas", "Notes"),
        );
        mk(&t.join("ws/skills/mine/SKILL.md"), &sk("mine", "Mine"));
        mk(
            &t.join("ob/settings.json"),
            &format!("{{\"last_vault\": \"{}\"}}", t.join("vault").display()),
        );
        mk(
            &t.join("vault/skills/ventas/SKILL.md"),
            &sk("ventas", "Ventas"),
        );
        std::env::set_var("HOME", &t);
        std::env::set_var("WORKSTUDIO_HOME", t.join("ws"));
        std::env::set_var("BRAIN_HOME", t.join("brain"));
        std::env::set_var("OPENCUE_HOME", t.join("oc"));
        std::env::set_var("OPENBLOCKS_HOME", t.join("ob"));
        std::env::set_var("CODEX_HOME", t.join(".codex"));
        let all = list(None);
        let find = |n: &str| {
            all.iter()
                .find(|s| s.name == n)
                .unwrap_or_else(|| panic!("missing {n}"))
        };
        assert_eq!(find("mine").group, "WorkStudio");
        assert_eq!(find("second-brain-setup").group, "OpenBlocks");
        assert_eq!(find("ventas").group, "OpenBlocks");
        assert_eq!(find("pdf").group, "Claude Code");
        assert_eq!(find("ux").group, "Claude Code · plugins");
        assert_eq!(find("review").group, "Codex");
        assert_eq!(find("plan").group, "Gemini");
        assert_eq!(find("mail").group, "OpenCue");
        let n = find("notas");
        assert_eq!(n.group, "brain");
        // Flat brain skills can be read; arbitrary markdown files cannot.
        assert!(content(&n.path).is_some());
        mk(&t.join("other/readme.md"), "x");
        assert!(content(&t.join("other/readme.md").to_string_lossy()).is_none());
        // Titles come out in a fixed order.
        let ranks: Vec<usize> = all.iter().map(|s| group_rank(&s.group)).collect();
        assert!(ranks.windows(2).all(|w| w[0] <= w[1]));
        let _ = std::fs::remove_dir_all(&t);
    }
}
