mod apps;
mod catalog;
mod chat;
mod hub;
mod mcp;
mod paths;
mod pty;
mod settings;
mod shellenv;
mod state;
mod updates;
mod web;
mod webstore;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

fn find_app(id: &str) -> R<catalog::AppDef> {
    catalog::get(id).ok_or_else(|| {
        format!(
            "{} «{id}»",
            settings::tr("No conozco la app", "Unknown app")
        )
    })
}

// ---------- catalog & apps ----------

#[derive(Serialize)]
struct CatalogOut {
    apps: Vec<catalog::AppDef>,
    clis: Vec<catalog::CliDef>,
}

#[tauri::command]
fn get_catalog() -> CatalogOut {
    CatalogOut {
        apps: catalog::apps(),
        clis: catalog::clis(),
    }
}

#[tauri::command]
async fn get_statuses(app: AppHandle, refresh: bool) -> Vec<apps::AppStatus> {
    if refresh {
        return tauri::async_runtime::spawn_blocking(move || state::refresh_statuses(&app, true))
            .await
            .unwrap_or_default();
    }
    state::shared().statuses.lock().unwrap().clone()
}

#[tauri::command]
async fn app_start(app: AppHandle, id: String) -> R<()> {
    let def = find_app(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        apps::start(&def).map_err(e)?;
        // Give the backend a moment, then report.
        for _ in 0..25 {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if apps::status(&def, false).running {
                break;
            }
        }
        state::refresh_statuses(&app, false);
        Ok(())
    })
    .await
    .map_err(e)?
}

#[tauri::command]
async fn app_stop(app: AppHandle, id: String) -> R<()> {
    let def = find_app(&id)?;
    let _ = embed_close(app.clone(), id.clone());
    tauri::async_runtime::spawn_blocking(move || {
        apps::stop(&def).map_err(e)?;
        std::thread::sleep(std::time::Duration::from_millis(900));
        state::refresh_statuses(&app, false);
        Ok(())
    })
    .await
    .map_err(e)?
}

#[tauri::command]
async fn app_open_native(id: String) -> R<()> {
    let def = find_app(&id)?;
    tauri::async_runtime::spawn_blocking(move || apps::open_native(&def).map_err(e))
        .await
        .map_err(e)?
}

#[tauri::command]
fn app_save(app: catalog::AppDef) -> R<catalog::AppDef> {
    let saved = catalog::save_user_app(app).map_err(e)?;
    let _ = mcp::write_generated();
    Ok(saved)
}

#[tauri::command]
fn app_remove(id: String) -> R<()> {
    catalog::remove_user_app(&id).map_err(e)?;
    let _ = mcp::write_generated();
    Ok(())
}

/// A manifest as JSON text, or an https URL to one.
#[tauri::command]
async fn app_import(source: String) -> R<Vec<catalog::AppDef>> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = if source.trim_start().starts_with("http") {
            anyhow::ensure!(
                source.trim_start().starts_with("https://"),
                "Usá una URL https"
            );
            ureq::get(source.trim()).call()?.into_string()?
        } else {
            source
        };
        let out = catalog::import_manifest(&text)?;
        let _ = mcp::write_generated();
        Ok(out)
    })
    .await
    .map_err(e)?
    .map_err(|err: anyhow::Error| err.to_string())
}

// ---------- embedded app views (a child webview over the content area) ----------

fn embed_label(id: &str) -> String {
    format!(
        "embed-{}",
        id.replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    )
}

#[tauri::command]
fn embed_show(app: AppHandle, id: String, url: String, x: f64, y: f64, w: f64, h: f64) -> R<()> {
    let label = embed_label(&id);
    let parsed: tauri::Url = url.parse().map_err(e)?;
    let host = parsed.host_str().unwrap_or("");
    if !(host == "127.0.0.1" || host == "localhost") {
        return Err(settings::tr(
            "Solo se pueden mostrar apps locales (127.0.0.1)",
            "Only local apps (127.0.0.1) can be shown",
        )
        .into());
    }
    // Hide the other embedded apps first: only one is visible at a time.
    for (l, wv) in app.webviews() {
        if l.starts_with("embed-") && l != label {
            let _ = wv.hide();
        }
    }
    if let Some(wv) = app.get_webview(&label) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(e)?;
        wv.set_size(LogicalSize::new(w.max(10.0), h.max(10.0)))
            .map_err(e)?;
        wv.show().map_err(e)?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("no main window")?;
    let mut builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed));
    // Bring the app's own preferences (brain: theme, language, menu, graph colors…).
    if let Some(script) = catalog::get(&id).and_then(|a| webstore::init_script(&a.webstore, &url)) {
        builder = builder.initialization_script(&script);
    }
    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(w.max(10.0), h.max(10.0)),
        )
        .map_err(e)?;
    Ok(())
}

#[tauri::command]
fn embed_hide_all(app: AppHandle) {
    for (l, wv) in app.webviews() {
        if l.starts_with("embed-") {
            let _ = wv.hide();
        }
    }
}

#[tauri::command]
fn embed_reload(app: AppHandle, id: String) -> R<()> {
    if let Some(wv) = app.get_webview(&embed_label(&id)) {
        wv.reload().map_err(e)?;
    }
    Ok(())
}

#[tauri::command]
fn embed_close(app: AppHandle, id: String) -> R<()> {
    if let Some(wv) = app.get_webview(&embed_label(&id)) {
        wv.close().map_err(e)?;
    }
    Ok(())
}

// ---------- terminals ----------

#[tauri::command]
fn pty_spawn(app: AppHandle, opts: pty::SpawnOpts) -> R<()> {
    pty::spawn(app, opts).map_err(e)
}

#[tauri::command]
fn pty_write(id: String, data: String) -> R<()> {
    pty::write(&id, &data).map_err(e)
}

#[tauri::command]
fn pty_resize(id: String, cols: u16, rows: u16) -> R<()> {
    pty::resize(&id, cols, rows).map_err(e)
}

#[tauri::command]
fn pty_kill(id: String) {
    pty::kill(&id)
}

#[tauri::command]
fn pty_alive() -> Vec<String> {
    pty::alive()
}

#[derive(Serialize)]
struct CliStatus {
    id: String,
    installed: bool,
    version: Option<String>,
    path: Option<String>,
}

#[tauri::command]
async fn clis_status() -> Vec<CliStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        let list = catalog::clis();
        let handles: Vec<_> = list
            .into_iter()
            .map(|c| {
                std::thread::spawn(move || {
                    let path = which::which(&c.bin)
                        .ok()
                        .map(|p| p.to_string_lossy().into_owned());
                    let version = if path.is_some() {
                        updates::cli_version(&c.version)
                    } else {
                        None
                    };
                    CliStatus {
                        id: c.id,
                        installed: path.is_some(),
                        version,
                        path,
                    }
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    })
    .await
    .unwrap_or_default()
}

// ---------- MCP ----------

#[tauri::command]
async fn mcp_list() -> Vec<mcp::Server> {
    tauri::async_runtime::spawn_blocking(mcp::servers)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn mcp_save(server: mcp::Server) -> R<()> {
    mcp::save_user_server(server).map_err(e)
}

#[tauri::command]
fn mcp_remove(name: String) -> R<()> {
    mcp::remove_user_server(&name).map_err(e)
}

#[tauri::command]
fn mcp_toggle(name: String, enabled: bool) -> R<()> {
    mcp::set_enabled(&name, enabled).map_err(e)
}

#[tauri::command]
async fn mcp_clients() -> Vec<mcp::ClientStatus> {
    tauri::async_runtime::spawn_blocking(mcp::clients)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn mcp_client_set(app: AppHandle, id: String, connect: bool) -> R<()> {
    mcp::set_client(&id, connect).map_err(e)?;
    state::notify(
        &app,
        "",
        "success",
        if connect {
            settings::tr("MCP conectado", "MCP connected")
        } else {
            settings::tr("MCP desconectado", "MCP disconnected")
        },
        &format!(
            "{id}: {}",
            if connect {
                settings::tr(
                    "ya tiene las herramientas de tus apps. Reinicialo para que las cargue.",
                    "now has the tools of your apps. Restart it to load them.",
                )
            } else {
                settings::tr(
                    "se quitaron los servidores de WorkStudio.",
                    "WorkStudio's servers were removed.",
                )
            }
        ),
        "mcp",
    );
    Ok(())
}

#[tauri::command]
fn mcp_import(client: String, name: String) -> R<()> {
    mcp::import(&client, &name).map_err(e)
}

#[tauri::command]
async fn mcp_launch_info() -> mcp::LaunchInfo {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = mcp::write_generated();
        mcp::launch_info()
    })
    .await
    .unwrap()
}

#[derive(Serialize)]
struct Preview {
    claude: String,
    codex: String,
    workspace: String,
    members: Vec<String>,
}

#[tauri::command]
async fn mcp_preview() -> R<Preview> {
    tauri::async_runtime::spawn_blocking(|| {
        mcp::write_generated().map_err(e)?;
        Ok(Preview {
            claude: std::fs::read_to_string(mcp::claude_config_path()).unwrap_or_default(),
            codex: std::fs::read_to_string(paths::ws_dir().join("mcp").join("codex.toml"))
                .unwrap_or_default(),
            workspace: paths::workspace_dir().to_string_lossy().into_owned(),
            members: mcp::active()
                .into_iter()
                .filter(|s| !s.is_http())
                .map(|s| s.name)
                .collect(),
        })
    })
    .await
    .map_err(e)?
}

/// Starts the hub once and lists what it carries (the MCP page shows it).
#[tauri::command]
async fn mcp_hub_tools() -> Vec<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(|| {
        let hub = hub::Hub::start(None);
        hub.tools
            .iter()
            .map(|t| serde_json::json!({"name": t["name"], "description": t["description"]}))
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn opencue_agents() -> Vec<mcp::OpenCueAgent> {
    tauri::async_runtime::spawn_blocking(mcp::opencue_agents)
        .await
        .unwrap_or_default()
}

// ---------- chat ----------

#[tauri::command]
async fn chat_models() -> Vec<chat::Model> {
    tauri::async_runtime::spawn_blocking(chat::models)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn chat_list() -> Vec<chat::ChatSummary> {
    chat::list()
}

#[tauri::command]
fn chat_get(id: String) -> Option<chat::Chat> {
    chat::load(&id)
}

#[tauri::command]
fn chat_delete(id: String) {
    chat::stop(&id);
    chat::delete(&id);
}

#[tauri::command]
fn chat_send(
    app: AppHandle,
    chat: Option<String>,
    text: String,
    model: String,
    tools: Vec<String>,
) -> R<String> {
    chat::send(app, chat, text, model, tools).map_err(e)
}

#[tauri::command]
fn chat_stop(id: String) {
    chat::stop(&id)
}

#[tauri::command]
fn chat_running(id: String) -> bool {
    chat::is_running(&id)
}

// ---------- notifications ----------

#[tauri::command]
fn notes_list() -> Vec<state::Notification> {
    state::shared().notes.lock().unwrap().clone()
}

#[tauri::command]
fn notes_mark_read(app: AppHandle, ids: Vec<u64>) {
    {
        let mut notes = state::shared().notes.lock().unwrap();
        for n in notes.iter_mut() {
            if ids.is_empty() || ids.contains(&n.id) {
                n.read = true;
            }
        }
    }
    state::save_notes();
    let _ = app.emit("ws-notes-changed", ());
}

#[tauri::command]
fn notes_clear(app: AppHandle) {
    state::shared().notes.lock().unwrap().clear();
    state::save_notes();
    let _ = app.emit("ws-notes-changed", ());
}

#[tauri::command]
fn notify_test(app: AppHandle) {
    state::notify(
        &app,
        "",
        "info",
        settings::tr("Notificaciones activas", "Notifications are on"),
        settings::tr(
            "Así se ven los avisos de AI WorkStudio.",
            "This is how AI WorkStudio's notices look.",
        ),
        "",
    );
}

/// Lets the UI add its own events (terminal finished, update installed…).
#[tauri::command]
fn notify_push(
    app: AppHandle,
    app_id: String,
    kind: String,
    title: String,
    body: String,
    action: String,
) {
    state::notify(&app, &app_id, &kind, &title, &body, &action);
}

// ---------- updates & settings ----------

#[tauri::command]
fn updates_get() -> Vec<updates::UpdateInfo> {
    state::shared().updates.lock().unwrap().clone()
}

#[tauri::command]
async fn updates_check(app: AppHandle, force: bool) -> Vec<updates::UpdateInfo> {
    tauri::async_runtime::spawn_blocking(move || state::run_update_check(&app, force))
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn settings_get() -> settings::Settings {
    settings::load()
}

#[tauri::command]
fn settings_set(value: settings::Settings) -> R<()> {
    settings::save(&value).map_err(e)?;
    let _ = mcp::write_generated();
    Ok(())
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    os: String,
    arch: String,
    data_dir: String,
    workspace: String,
    shell: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        data_dir: paths::ws_dir().to_string_lossy().into_owned(),
        workspace: paths::workspace_dir().to_string_lossy().into_owned(),
        shell: shellenv::user_shell(),
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let h = app.handle();
    let version = MenuItem::with_id(
        h,
        "version",
        format!("AI WorkStudio {}", env!("CARGO_PKG_VERSION")),
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(
        h,
        "open",
        settings::tr("Abrir WorkStudio", "Open WorkStudio"),
        true,
        None::<&str>,
    )?;
    let brain = MenuItem::with_id(h, "nav:app:brain", "brain", true, None::<&str>)?;
    let lumina = MenuItem::with_id(h, "nav:app:lumina", "Lumina", true, None::<&str>)?;
    let opencue = MenuItem::with_id(h, "nav:app:opencue", "OpenCue", true, None::<&str>)?;
    let chat_item = MenuItem::with_id(h, "nav:chat", "Chat", true, None::<&str>)?;
    let term = MenuItem::with_id(
        h,
        "nav:terminals",
        settings::tr("Terminales", "Terminals"),
        true,
        None::<&str>,
    )?;
    let upd = MenuItem::with_id(
        h,
        "nav:updates",
        settings::tr("Buscar actualizaciones", "Check for updates"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(h, "quit", settings::tr("Salir", "Quit"), true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(h);
    let menu = Menu::with_items(
        h,
        &[
            &version,
            &sep()?,
            &open,
            &brain,
            &lumina,
            &opencue,
            &chat_item,
            &term,
            &sep()?,
            &upd,
            &sep()?,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("AI WorkStudio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let id = ev.id().as_ref();
            match id {
                "open" => show_main(app),
                "quit" => {
                    pty::kill_all();
                    app.exit(0);
                }
                _ => {
                    if let Some(route) = id.strip_prefix("nav:") {
                        show_main(app);
                        let _ = app.emit("navigate", route.to_string());
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                show_main(tray.app_handle());
            }
        });
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
        tray = tray.icon(icon).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// `workstudio mcp …`: runs the MCP hub on stdin/stdout instead of the app.
pub fn serve_mcp(args: &[String]) {
    hub::serve_stdio(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    shellenv::load_login_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            build_tray(app)?;
            state::start_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && settings::load().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_catalog,
            get_statuses,
            app_start,
            app_stop,
            app_open_native,
            app_save,
            app_remove,
            app_import,
            embed_show,
            embed_hide_all,
            embed_reload,
            embed_close,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_alive,
            clis_status,
            mcp_list,
            mcp_save,
            mcp_remove,
            mcp_toggle,
            mcp_clients,
            mcp_client_set,
            mcp_import,
            mcp_launch_info,
            mcp_preview,
            mcp_hub_tools,
            opencue_agents,
            chat_models,
            chat_list,
            chat_get,
            chat_delete,
            chat_send,
            chat_stop,
            chat_running,
            notes_list,
            notes_mark_read,
            notes_clear,
            notify_test,
            notify_push,
            updates_get,
            updates_check,
            settings_get,
            settings_set,
            app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI WorkStudio")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                pty::kill_all();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            let _ = app;
        });
}
