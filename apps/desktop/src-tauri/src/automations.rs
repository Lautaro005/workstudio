//! Automations: prompts that run by themselves on a schedule — every day, on some days of the week,
//! every N minutes or only when asked — as a new chat, with the model, pills, skills, project and
//! working folder the user picked. The classic ones come from Ben AI's second-brain method: a daily
//! update that saves insights from meetings, and a weekly health check.
//!
//! They live in `~/.workstudio/automations.json` and run while WorkStudio is open (it stays in the
//! tray when the window closes). A run that was missed because the app was closed happens once when
//! it opens again. Every run is a normal chat titled "⚡ <name>", so the answer, the tools it used
//! and the artifacts are there to read.

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Schedule {
    /// "daily" | "weekly" | "interval" | "manual"
    pub kind: String,
    /// "HH:MM", local time (daily and weekly).
    pub time: String,
    /// Weekly: days of the week, 0 = Sunday … 6 = Saturday.
    pub days: Vec<u32>,
    /// Interval: minutes between runs.
    pub every_minutes: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    /// Chat model id (`claude:sonnet`, `codex:`, `ollama:llama3.2`…).
    pub model: String,
    /// Pills: brain, lumina, openblocks, web.
    pub tools: Vec<String>,
    /// SKILL.md paths switched on for the run.
    pub skills: Vec<String>,
    pub project: String,
    pub folder: String,
    /// "read" | "edit"
    pub mode: String,
    pub enabled: bool,
    pub schedule: Schedule,
    pub created: u64,
    /// Milliseconds since the epoch of the last run (0 = never) and the chat it made.
    pub last_run: u64,
    pub last_chat: String,
    pub last_error: String,
    pub runs: u32,
}

fn file() -> std::path::PathBuf {
    crate::paths::ws_file("automations.json")
}

static LOCK: Mutex<()> = Mutex::new(());

fn read() -> Vec<Automation> {
    std::fs::read_to_string(file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write(list: &[Automation]) -> anyhow::Result<()> {
    crate::paths::write_atomic(&file(), &serde_json::to_string_pretty(list)?)?;
    Ok(())
}

pub fn list() -> Vec<Automation> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read()
}

fn clean_time(t: &str) -> String {
    let (h, m) = t.split_once(':').unwrap_or(("9", "0"));
    let h: u32 = h.trim().parse().unwrap_or(9).min(23);
    let m: u32 = m.trim().parse().unwrap_or(0).min(59);
    format!("{h:02}:{m:02}")
}

/// Creates or updates an automation (matched by id).
pub fn save(mut a: Automation) -> anyhow::Result<Automation> {
    anyhow::ensure!(
        !a.name.trim().is_empty(),
        crate::settings::tr("Poné un nombre", "Give it a name")
    );
    anyhow::ensure!(
        !a.prompt.trim().is_empty(),
        crate::settings::tr("Escribí qué tiene que hacer", "Write what it should do")
    );
    a.name = a.name.trim().to_string();
    a.schedule.time = clean_time(&a.schedule.time);
    a.schedule.days.retain(|d| *d < 7);
    a.schedule.days.sort_unstable();
    a.schedule.days.dedup();
    if a.schedule.kind == "weekly" && a.schedule.days.is_empty() {
        a.schedule.days = vec![1, 2, 3, 4, 5];
    }
    if !matches!(
        a.schedule.kind.as_str(),
        "daily" | "weekly" | "interval" | "manual"
    ) {
        a.schedule.kind = "daily".into();
    }
    a.schedule.every_minutes = a.schedule.every_minutes.clamp(5, 60 * 24 * 30);
    if a.mode != "edit" {
        a.mode = "read".into();
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read();
    if a.id.is_empty() {
        a.id = format!("a{}", crate::chat::now());
        a.created = crate::chat::now();
        all.push(a.clone());
    } else if let Some(old) = all.iter_mut().find(|x| x.id == a.id) {
        // Keep the run history; a changed schedule counts from now.
        a.created = if old.schedule == a.schedule {
            old.created
        } else {
            crate::chat::now()
        };
        a.last_run = old.last_run;
        a.last_chat = old.last_chat.clone();
        a.last_error = old.last_error.clone();
        a.runs = old.runs;
        *old = a.clone();
    } else {
        a.created = crate::chat::now();
        all.push(a.clone());
    }
    write(&all)?;
    Ok(a)
}

pub fn delete(id: &str) -> anyhow::Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read();
    all.retain(|a| a.id != id);
    write(&all)
}

pub fn set_enabled(id: &str, on: bool) -> anyhow::Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read();
    if let Some(a) = all.iter_mut().find(|a| a.id == id) {
        a.enabled = on;
        if on {
            // Turning it on counts from now: it doesn't catch up on what it missed while off.
            a.created = a.created.max(crate::chat::now());
        }
    }
    write(&all)
}

// ---------- schedule ----------

/// The latest moment, at or before `now` (local wall clock), at which the schedule fires.
/// Interval and manual schedules have none.
pub fn last_occurrence(s: &Schedule, now: NaiveDateTime) -> Option<NaiveDateTime> {
    if s.kind != "daily" && s.kind != "weekly" {
        return None;
    }
    let (h, m) = s.time.split_once(':')?;
    let t = NaiveTime::from_hms_opt(h.parse().ok()?, m.parse().ok()?, 0)?;
    for back in 0..8 {
        let day: NaiveDate = now.date() - Duration::days(back);
        if s.kind == "weekly" && !s.days.contains(&day.weekday().num_days_from_sunday()) {
            continue;
        }
        let at = day.and_time(t);
        if at <= now {
            return Some(at);
        }
    }
    None
}

fn local_ms(n: NaiveDateTime) -> u64 {
    Local
        .from_local_datetime(&n)
        .earliest()
        .map(|d| d.timestamp_millis().max(0) as u64)
        .unwrap_or(0)
}

/// Should this automation run now? `now_ms` is the wall clock in milliseconds.
pub fn is_due(a: &Automation, now: NaiveDateTime, now_ms: u64) -> bool {
    if !a.enabled {
        return false;
    }
    let since = a.last_run.max(a.created);
    match a.schedule.kind.as_str() {
        "interval" => now_ms >= since + a.schedule.every_minutes as u64 * 60_000,
        "daily" | "weekly" => last_occurrence(&a.schedule, now)
            .map(|o| local_ms(o) > since)
            .unwrap_or(false),
        _ => false,
    }
}

/// When it will run next, in milliseconds (None for manual ones).
pub fn next_run(a: &Automation) -> Option<u64> {
    let now = Local::now().naive_local();
    match a.schedule.kind.as_str() {
        "interval" => Some(a.last_run.max(a.created) + a.schedule.every_minutes as u64 * 60_000),
        "daily" | "weekly" => {
            let (h, m) = a.schedule.time.split_once(':')?;
            let t = NaiveTime::from_hms_opt(h.parse().ok()?, m.parse().ok()?, 0)?;
            for ahead in 0..8 {
                let day = now.date() + Duration::days(ahead);
                if a.schedule.kind == "weekly"
                    && !a
                        .schedule
                        .days
                        .contains(&day.weekday().num_days_from_sunday())
                {
                    continue;
                }
                let at = day.and_time(t);
                if at > now {
                    return Some(local_ms(at));
                }
            }
            None
        }
        _ => None,
    }
}

#[derive(Serialize)]
pub struct View {
    #[serde(flatten)]
    pub a: Automation,
    pub next_run: Option<u64>,
}

pub fn list_view() -> Vec<View> {
    list()
        .into_iter()
        .map(|a| View {
            next_run: if a.enabled { next_run(&a) } else { None },
            a,
        })
        .collect()
}

// ---------- running ----------

fn client_now() -> crate::prompt::Client {
    let n = Local::now();
    crate::prompt::Client {
        date: n.format("%A, %B %-d, %Y, %H:%M").to_string(),
        tz: std::env::var("TZ").unwrap_or_default(),
    }
}

/// Starts one run as a new chat and returns its id.
pub fn run(app: &AppHandle, id: &str) -> anyhow::Result<String> {
    let a = {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = read();
        let Some(a) = all.iter_mut().find(|a| a.id == id) else {
            anyhow::bail!("no automation {id}");
        };
        a.last_run = crate::chat::now();
        a.runs += 1;
        let copy = a.clone();
        write(&all)?;
        copy
    };
    let res = (|| -> anyhow::Result<String> {
        anyhow::ensure!(
            !a.model.is_empty(),
            crate::settings::tr("Elegí un modelo", "Pick a model")
        );
        let chat = crate::chat::send(
            app.clone(),
            crate::chat::SendOpts {
                chat: None,
                text: a.prompt.clone(),
                model: a.model.clone(),
                tools: a.tools.clone(),
                skills: a.skills.clone(),
                project: a.project.clone(),
                folder: a.folder.clone(),
                mode: a.mode.clone(),
                client: client_now(),
                ..Default::default()
            },
        )?;
        let _ = crate::chat::update(&chat, Some(format!("⚡ {}", a.name)), None);
        Ok(chat)
    })();
    {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = read();
        if let Some(x) = all.iter_mut().find(|x| x.id == id) {
            match &res {
                Ok(chat) => {
                    x.last_chat = chat.clone();
                    x.last_error.clear();
                }
                Err(e) => x.last_error = e.to_string(),
            }
            let _ = write(&all);
        }
    }
    let _ = app.emit("automations-changed", ());
    res
}

/// The scheduler: looks every 20 seconds for automations that are due.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Let the app finish starting before the first run.
        std::thread::sleep(std::time::Duration::from_secs(8));
        loop {
            let now = Local::now();
            let due: Vec<String> = list()
                .into_iter()
                .filter(|a| is_due(a, now.naive_local(), now.timestamp_millis().max(0) as u64))
                .map(|a| a.id)
                .collect();
            for id in due {
                let _ = run(&app, &id);
            }
            std::thread::sleep(std::time::Duration::from_secs(20));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    fn daily(time: &str) -> Schedule {
        Schedule {
            kind: "daily".into(),
            time: time.into(),
            ..Default::default()
        }
    }

    #[test]
    fn daily_fires_at_the_hour_and_catches_up_once() {
        // 2026-11-03 is a Tuesday.
        let s = daily("07:30");
        assert_eq!(
            last_occurrence(&s, at(2026, 11, 3, 8, 0)),
            Some(at(2026, 11, 3, 7, 30))
        );
        // Before today's time the last one is yesterday's.
        assert_eq!(
            last_occurrence(&s, at(2026, 11, 3, 7, 0)),
            Some(at(2026, 11, 2, 7, 30))
        );
        assert_eq!(
            last_occurrence(&s, at(2026, 11, 3, 7, 30)),
            Some(at(2026, 11, 3, 7, 30))
        );
    }

    #[test]
    fn weekly_only_on_its_days() {
        let s = Schedule {
            kind: "weekly".into(),
            time: "20:00".into(),
            days: vec![0], // Sunday
            ..Default::default()
        };
        // Tuesday → the Sunday before (2026-11-01).
        assert_eq!(
            last_occurrence(&s, at(2026, 11, 3, 9, 0)),
            Some(at(2026, 11, 1, 20, 0))
        );
        // Sunday 19:00 → the Sunday before that.
        assert_eq!(
            last_occurrence(&s, at(2026, 11, 1, 19, 0)),
            Some(at(2026, 10, 25, 20, 0))
        );
    }

    #[test]
    fn due_only_once_and_not_before_creation() {
        let now = at(2026, 11, 3, 8, 0);
        let now_ms = local_ms(now);
        let mut a = Automation {
            enabled: true,
            schedule: daily("07:30"),
            created: local_ms(at(2026, 11, 3, 9, 0)) - 3_600_000 * 2, // 07:00 today
            ..Default::default()
        };
        assert!(is_due(&a, now, now_ms));
        a.last_run = now_ms;
        assert!(!is_due(&a, now, now_ms), "ran already");
        // Created after today's time: wait for tomorrow.
        a.last_run = 0;
        a.created = local_ms(at(2026, 11, 3, 7, 45));
        assert!(!is_due(&a, now, now_ms));
        a.enabled = false;
        a.created = 0;
        assert!(!is_due(&a, now, now_ms), "off");
    }

    #[test]
    fn interval_and_manual() {
        let mut a = Automation {
            enabled: true,
            schedule: Schedule {
                kind: "interval".into(),
                every_minutes: 30,
                ..Default::default()
            },
            created: 1_000_000,
            ..Default::default()
        };
        let now = at(2026, 11, 3, 8, 0);
        assert!(!is_due(&a, now, 1_000_000 + 29 * 60_000));
        assert!(is_due(&a, now, 1_000_000 + 30 * 60_000));
        a.schedule.kind = "manual".into();
        assert!(!is_due(&a, now, u64::MAX / 2));
    }

    #[test]
    fn times_are_cleaned() {
        assert_eq!(clean_time("7:5"), "07:05");
        assert_eq!(clean_time("99:99"), "23:59");
        assert_eq!(clean_time("x"), "09:00");
    }
}
