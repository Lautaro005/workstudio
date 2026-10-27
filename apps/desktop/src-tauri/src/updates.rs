//! Latest versions from GitHub releases (apps) and the npm registry (agent CLIs).

use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, Default)]
pub struct Release {
    pub tag: String,
    pub name: String,
    pub url: String,
    pub published: String,
    pub notes: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct UpdateInfo {
    pub id: String,
    /// "app" or "cli"
    pub kind: String,
    pub name: String,
    pub current: Option<String>,
    pub latest: Option<String>,
    pub available: bool,
    pub url: String,
    pub notes: String,
    pub published: String,
    pub command: String,
    pub installed: bool,
}

type Cache = Mutex<HashMap<String, (Instant, Option<Release>)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("AI-WorkStudio/", env!("CARGO_PKG_VERSION")))
        .build()
}

pub fn github_latest(repo: &str, force: bool) -> Option<Release> {
    if repo.is_empty() {
        return None;
    }
    let key = format!("gh:{repo}");
    if !force {
        if let Some((t, r)) = cache().lock().unwrap().get(&key) {
            if t.elapsed() < Duration::from_secs(1800) {
                return r.clone();
            }
        }
    }
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let res = agent()
        .get(&url)
        .set("Accept", "application/vnd.github+json")
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .map(|v| {
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let mut notes = s("body");
            if notes.chars().count() > 900 {
                notes = notes.chars().take(900).collect::<String>() + "…";
            }
            Release {
                tag: s("tag_name"),
                name: s("name"),
                url: s("html_url"),
                published: s("published_at"),
                notes,
            }
        })
        .filter(|r| !r.tag.is_empty());
    cache()
        .lock()
        .unwrap()
        .insert(key, (Instant::now(), res.clone()));
    res
}

pub fn npm_latest(pkg: &str, force: bool) -> Option<String> {
    if pkg.is_empty() {
        return None;
    }
    let key = format!("npm:{pkg}");
    if !force {
        if let Some((t, r)) = cache().lock().unwrap().get(&key) {
            if t.elapsed() < Duration::from_secs(1800) {
                return r.as_ref().map(|r| r.tag.clone());
            }
        }
    }
    let res = agent()
        .get(&format!("https://registry.npmjs.org/{pkg}/latest"))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from));
    cache().lock().unwrap().insert(
        key,
        (
            Instant::now(),
            res.clone().map(|t| Release {
                tag: t,
                ..Default::default()
            }),
        ),
    );
    res
}

fn parts(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// Compares versions by their numbers: "v0.03.3.4" == "0.3.3.4", "0.1.10" > "0.1.9".
pub fn compare(a: &str, b: &str) -> Ordering {
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (
            pa.get(i).copied().unwrap_or(0),
            pb.get(i).copied().unwrap_or(0),
        );
        match x.cmp(&y) {
            Ordering::Equal => continue,
            o => return o,
        }
    }
    Ordering::Equal
}

pub fn newer(latest: &str, current: &str) -> bool {
    !parts(latest).is_empty()
        && !parts(current).is_empty()
        && compare(latest, current) == Ordering::Greater
}

/// One row per app of the catalog and per agent CLI.
pub fn check_all(force: bool) -> Vec<UpdateInfo> {
    let mut out = Vec::new();
    for app in crate::catalog::apps() {
        let st = crate::apps::status(&app, true);
        let rel = github_latest(&app.repo, force);
        let latest = rel.as_ref().map(|r| r.tag.clone());
        let available = st.installed
            && match (&latest, &st.version) {
                (Some(l), Some(c)) => newer(l, c),
                _ => false,
            };
        out.push(UpdateInfo {
            id: app.id.clone(),
            kind: "app".into(),
            name: app.name.clone(),
            current: st.version.clone(),
            latest,
            available,
            url: rel
                .as_ref()
                .map(|r| r.url.clone())
                .unwrap_or_else(|| app.site.clone()),
            notes: rel.as_ref().map(|r| r.notes.clone()).unwrap_or_default(),
            published: rel
                .as_ref()
                .map(|r| r.published.clone())
                .unwrap_or_default(),
            command: if st.installed {
                app.update.here().to_string()
            } else {
                app.install.here().to_string()
            },
            installed: st.installed,
        });
    }
    for cli in crate::catalog::clis() {
        if !cli.app.is_empty() {
            continue; // the app row already covers it
        }
        let installed = crate::shellenv::has(&cli.bin);
        let current = if installed {
            cli_version(&cli.version)
        } else {
            None
        };
        let latest = npm_latest(&cli.npm, force);
        let available =
            installed && matches!((&latest, &current), (Some(l), Some(c)) if newer(l, c));
        out.push(UpdateInfo {
            id: cli.id.clone(),
            kind: "cli".into(),
            name: cli.name.clone(),
            current,
            latest,
            available,
            url: if cli.npm.is_empty() {
                String::new()
            } else {
                format!("https://www.npmjs.com/package/{}", cli.npm)
            },
            notes: String::new(),
            published: String::new(),
            command: if installed {
                cli.update.here().to_string()
            } else {
                cli.install.here().to_string()
            },
            installed,
        });
    }
    out
}

pub fn cli_version(cmd: &str) -> Option<String> {
    let out = crate::shellenv::capture(&crate::paths::expand(cmd), Duration::from_secs(6))?;
    let first = out.lines().next().unwrap_or("");
    // "2.1.4 (Claude Code)" / "codex-cli 0.50.0" / "0.12.0"
    first
        .split_whitespace()
        .find(|w| {
            w.chars()
                .next()
                .map(|c| c.is_ascii_digit() || c == 'v')
                .unwrap_or(false)
                && w.contains('.')
        })
        .map(|w| w.trim_start_matches('v').to_string())
        .or_else(|| Some(first.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_like_people_do() {
        assert!(newer("v0.03.3.4", "v0.03.3.3"));
        assert!(!newer("v0.03.3.4", "0.3.3.4"));
        assert!(newer("0.1.10", "0.1.9"));
        assert!(!newer("v0.5.2", "0.5.2"));
        assert!(!newer("", "1.0"));
    }
}
