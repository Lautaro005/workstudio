//! Shared state and the background watcher: app status, the notification center (WorkStudio's own
//! events plus brain's vault changes and Lumina's recordings) and the periodic update check.

use crate::apps::AppStatus;
use crate::settings::tr;
use crate::updates::UpdateInfo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Notification {
    pub id: u64,
    pub ts: u64,
    pub app: String,
    /// "info" | "success" | "warning" | "update" | "activity"
    pub kind: String,
    pub title: String,
    pub body: String,
    pub read: bool,
    /// What clicking it does in the UI: "app:<id>", "updates", "mcp", "terminals".
    pub action: String,
}

#[derive(Default)]
pub struct Shared {
    pub statuses: Mutex<Vec<AppStatus>>,
    pub notes: Mutex<Vec<Notification>>,
    pub updates: Mutex<Vec<UpdateInfo>>,
    pub last_update_check: Mutex<Option<Instant>>,
}

pub fn shared() -> &'static Shared {
    static S: OnceLock<Shared> = OnceLock::new();
    S.get_or_init(|| {
        let s = Shared::default();
        *s.notes.lock().unwrap() = load_notes();
        s
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn notes_path() -> std::path::PathBuf {
    crate::paths::ws_file("notifications.json")
}

fn load_notes() -> Vec<Notification> {
    std::fs::read_to_string(notes_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_notes() {
    let notes = shared().notes.lock().unwrap().clone();
    if let Ok(text) = serde_json::to_string(&notes) {
        let _ = crate::paths::write_atomic(&notes_path(), &text);
    }
}

/// Adds a notification to the center and, when allowed, shows it as a system notification.
pub fn notify(app: &AppHandle, app_id: &str, kind: &str, title: &str, body: &str, action: &str) {
    let settings = crate::settings::load();
    let n = {
        let mut notes = shared().notes.lock().unwrap();
        let id = notes.iter().map(|n| n.id).max().unwrap_or(0) + 1;
        let n = Notification {
            id,
            ts: now_ms(),
            app: app_id.into(),
            kind: kind.into(),
            title: title.into(),
            body: body.into(),
            read: false,
            action: action.into(),
        };
        notes.push(n.clone());
        let len = notes.len();
        if len > 300 {
            notes.drain(0..len - 300);
        }
        n
    };
    save_notes();
    let _ = app.emit("ws-notification", &n);
    if settings.system_notifications && (app_id.is_empty() || settings.app_notifies(app_id)) {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

fn name_of(id: &str) -> String {
    crate::catalog::get(id)
        .map(|a| a.name)
        .unwrap_or_else(|| id.to_string())
}

pub fn refresh_statuses(app: &AppHandle, with_version: bool) -> Vec<AppStatus> {
    let previous: HashMap<String, AppStatus> = shared()
        .statuses
        .lock()
        .unwrap()
        .iter()
        .map(|s| (s.id.clone(), s.clone()))
        .collect();
    let list: Vec<AppStatus> = crate::catalog::apps()
        .iter()
        .map(|a| {
            let mut s = crate::apps::status(a, with_version);
            if !with_version {
                s.version = previous.get(&a.id).and_then(|p| p.version.clone());
            }
            s
        })
        .collect();
    *shared().statuses.lock().unwrap() = list.clone();
    let _ = app.emit("apps-status", &list);
    list
}

pub fn run_update_check(app: &AppHandle, force: bool) -> Vec<UpdateInfo> {
    let before: HashSet<String> = shared()
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter(|u| u.available)
        .map(|u| format!("{}@{:?}", u.id, u.latest))
        .collect();
    let list = crate::updates::check_all(force);
    *shared().updates.lock().unwrap() = list.clone();
    *shared().last_update_check.lock().unwrap() = Some(Instant::now());
    for u in list.iter().filter(|u| u.available) {
        let key = format!("{}@{:?}", u.id, u.latest);
        if !before.contains(&key) && !already_announced(&key) {
            notify(
                app,
                if u.kind == "app" { &u.id } else { "" },
                "update",
                &format!(
                    "{} {} {}",
                    u.name,
                    u.latest.clone().unwrap_or_default(),
                    tr("disponible", "available")
                ),
                &format!(
                    "{} {}. {}",
                    tr("Tenés la", "You have"),
                    u.current.clone().unwrap_or_default(),
                    tr(
                        "Actualizalo desde WorkStudio → Actualizaciones.",
                        "Update it from WorkStudio → Updates."
                    )
                ),
                "updates",
            );
            remember_announced(&key);
        }
    }
    let _ = app.emit("updates", &list);
    list
}

fn announced_path() -> std::path::PathBuf {
    crate::paths::ws_file("announced.json")
}
fn already_announced(key: &str) -> bool {
    std::fs::read_to_string(announced_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(|v| v.iter().any(|k| k == key))
        .unwrap_or(false)
}
fn remember_announced(key: &str) {
    let mut v: Vec<String> = std::fs::read_to_string(announced_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    v.push(key.into());
    if v.len() > 200 {
        v.drain(0..v.len() - 200);
    }
    let _ = crate::paths::write_atomic(
        &announced_path(),
        &serde_json::to_string(&v).unwrap_or_default(),
    );
}

/// Polls every few seconds. Kept simple on purpose: everything it calls has short timeouts.
pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        let mut brain_last: i64 = -1;
        let mut lumina_recording: Option<bool> = None;
        let mut first = true;
        // Start the apps the user wants running with WorkStudio.
        for id in crate::settings::load().autostart {
            if let Some(a) = crate::catalog::get(&id) {
                if !crate::apps::status(&a, false).running {
                    let _ = crate::apps::start(&a);
                }
            }
        }
        let _ = crate::mcp::write_generated();
        loop {
            let prev: HashMap<String, bool> = shared()
                .statuses
                .lock()
                .unwrap()
                .iter()
                .map(|s| (s.id.clone(), s.running))
                .collect();
            let list = refresh_statuses(&app, first || tick.is_multiple_of(8));
            if !first {
                for s in &list {
                    match prev.get(&s.id) {
                        Some(false) if s.running => notify(
                            &app,
                            &s.id,
                            "success",
                            &format!("{} {}", name_of(&s.id), tr("está corriendo", "is running")),
                            tr(
                                "Listo para usar desde WorkStudio.",
                                "Ready to use from WorkStudio.",
                            ),
                            &format!("app:{}", s.id),
                        ),
                        Some(true) if !s.running => notify(
                            &app,
                            &s.id,
                            "warning",
                            &format!("{} {}", name_of(&s.id), tr("se detuvo", "stopped")),
                            tr(
                                "Podés iniciarlo de nuevo desde Apps.",
                                "You can start it again from Apps.",
                            ),
                            &format!("app:{}", s.id),
                        ),
                        _ => {}
                    }
                }
            }
            let running = |id: &str| list.iter().any(|s| s.id == id && s.running);

            // brain: changes in the vault (what agents remembered, wrote or moved).
            if running("brain") {
                let url = format!("http://127.0.0.1:8765/api/activity?after={brain_last}");
                if let Some(v) = crate::apps::http_get_json(&url, 900) {
                    let last = v
                        .get("last_id")
                        .and_then(|x| x.as_i64())
                        .unwrap_or(brain_last);
                    if brain_last >= 0 {
                        let changes = v
                            .get("changes")
                            .and_then(|c| c.as_array())
                            .cloned()
                            .unwrap_or_default();
                        if !changes.is_empty() {
                            let paths: Vec<String> = changes
                                .iter()
                                .filter_map(|c| {
                                    c.get("path").and_then(|p| p.as_str()).map(String::from)
                                })
                                .take(3)
                                .collect();
                            let total = v
                                .get("total")
                                .and_then(|t| t.as_u64())
                                .unwrap_or(changes.len() as u64);
                            let title = if total == 1 {
                                tr(
                                    "brain: 1 cambio en el vault",
                                    "brain: 1 change in the vault",
                                )
                                .to_string()
                            } else {
                                format!(
                                    "brain: {total} {}",
                                    tr("cambios en el vault", "changes in the vault")
                                )
                            };
                            notify(
                                &app,
                                "brain",
                                "activity",
                                &title,
                                &paths.join(" · "),
                                "app:brain",
                            );
                        }
                    }
                    brain_last = last;
                }
            }

            // Lumina: a meeting started or ended.
            if running("lumina") {
                if let Some(v) =
                    crate::apps::http_get_json("http://127.0.0.1:47770/api/status", 900)
                {
                    let rec = v.get("session").map(|s| !s.is_null()).unwrap_or(false);
                    if let Some(was) = lumina_recording {
                        if rec && !was {
                            notify(
                                &app,
                                "lumina",
                                "activity",
                                tr("Lumina está grabando", "Lumina is recording"),
                                tr(
                                    "Se empezó a transcribir una reunión.",
                                    "A meeting is being transcribed.",
                                ),
                                "app:lumina",
                            );
                        } else if !rec && was {
                            notify(
                                &app,
                                "lumina",
                                "activity",
                                tr("Reunión terminada", "Meeting finished"),
                                tr(
                                    "Lumina está escribiendo las notas y el resumen.",
                                    "Lumina is writing the notes and the summary.",
                                ),
                                "app:lumina",
                            );
                        }
                    }
                    lumina_recording = Some(rec);
                }
            } else {
                lumina_recording = None;
            }

            let st = crate::settings::load();
            if st.auto_check_updates {
                let due = match *shared().last_update_check.lock().unwrap() {
                    None => tick >= 2,
                    Some(t) => {
                        t.elapsed() > Duration::from_secs(st.update_interval_hours.max(1) * 3600)
                    }
                };
                if due {
                    run_update_check(&app, false);
                }
            }
            first = false;
            tick += 1;
            std::thread::sleep(Duration::from_secs(6));
        }
    });
}
