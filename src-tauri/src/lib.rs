//! SF-Sync — agente residente na bandeja.

use std::sync::Arc;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub mod acl;
pub mod control;
pub mod dpapi;
pub mod google;
pub mod jobobj;
pub mod lock;
pub mod sync;
use sync::Engine;

#[tauri::command]
fn sync_status(engine: tauri::State<Arc<Engine>>) -> sync::Status {
    engine.status()
}

#[tauri::command]
fn sync_now(engine: tauri::State<Arc<Engine>>) -> Result<(), String> {
    let e = engine.inner().clone();
    std::thread::spawn(move || {
        if let Err(err) = e.sync_once() {
            tracing::error!("sync_now: {err:#}");
        }
    });
    Ok(())
}

// ─────────────── pareamento / conta ───────────────

#[tauri::command]
fn is_paired() -> bool {
    control::is_paired()
}

#[tauri::command]
fn pair_device(
    engine: tauri::State<Arc<Engine>>,
    jwt: String,
    name: String,
) -> Result<control::DeviceInfo, String> {
    engine.pair(&jwt, &name).map_err(|e| format!("{e:#}"))
}

// ─────────────── espaços ───────────────

#[tauri::command]
fn list_spaces(engine: tauri::State<Arc<Engine>>) -> Vec<sync::SpaceStatus> {
    engine.spaces_ui()
}

#[tauri::command]
fn list_invites(engine: tauri::State<Arc<Engine>>) -> Result<Vec<control::SpaceInvite>, String> {
    engine.list_invites().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn list_devices(engine: tauri::State<Arc<Engine>>) -> Result<control::DevicesView, String> {
    engine.list_devices().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn revoke_device(engine: tauri::State<Arc<Engine>>, device_id: String) -> Result<bool, String> {
    engine.revoke_device(&device_id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn accept_space(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.accept_space(&id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn create_space(
    engine: tauri::State<Arc<Engine>>,
    name: String,
    kind: String,
    folders: Vec<String>,
    backend_kind: String,
    encrypted: bool,
    gdrive_folder_id: String,
) -> Result<control::SpaceMeta, String> {
    engine.create_space(&name, &kind, folders, &backend_kind, encrypted, &gdrive_folder_id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn invite_to_space(engine: tauri::State<Arc<Engine>>, id: String, email: String) -> Result<control::InviteResult, String> {
    engine.invite_to_space(&id, &email).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn create_invite_link(engine: tauri::State<Arc<Engine>>, max_uses: u32, expires_days: i64) -> Result<String, String> {
    engine.create_invite_link(max_uses, expires_days).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn set_space_path(engine: tauri::State<Arc<Engine>>, id: String, local: String, connection_id: String, subpath: String) -> Result<(), String> {
    engine.set_space_path(&id, &local, &connection_id, &subpath).map_err(|e| format!("{e:#}"))
}

// ─────────────── Conexões ───────────────
#[tauri::command]
fn add_connection(engine: tauri::State<Arc<Engine>>, kind: String, label: String, token: String, nas_root: String) -> Result<control::ConnectionView, String> {
    engine.add_connection(&kind, &label, &token, &nas_root).map(control::ConnectionView::from).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn list_connections(engine: tauri::State<Arc<Engine>>) -> Vec<control::ConnectionView> {
    engine.list_connections()
}

#[tauri::command]
fn remove_connection(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.remove_connection(&id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn authorize_gdrive() -> Result<String, String> {
    tokio::task::spawn_blocking(|| -> anyhow::Result<String> {
        use std::os::windows::process::CommandExt;
        let rclone = sync::rclone_bin()?;
        let out = std::process::Command::new(rclone)
            .args(["authorize", "drive"])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| anyhow::anyhow!("falha ao rodar rclone authorize: {e}"))?;
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        extract_token_json(&combined)
            .ok_or_else(|| anyhow::anyhow!("não obtive o token do Google (autorização cancelada?)"))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

fn extract_token_json(s: &str) -> Option<String> {
    let at = s.find("access_token")?;
    let start = s[..at].rfind('{')?;
    let end = s[at..].find('}')? + at;
    Some(s[start..=end].to_string())
}

#[tauri::command]
fn unpair(engine: tauri::State<Arc<Engine>>) -> Result<(), String> {
    engine.unpair().map_err(|e| format!("{e:#}"))
}

/// Lista as subpastas de 1o nivel de um caminho (etapa "quais pastas" do wizard).
#[tauri::command]
fn list_subfolders(path: String) -> Vec<String> {
    std::fs::read_dir(&path)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| !n.starts_with('.') && !["node_modules", "target", "dist"].contains(&n.as_str()))
                .collect()
        })
        .unwrap_or_default()
}

/// Prévia (dry-run) do que a próxima rodada faria — para o usuário revisar antes.
#[tauri::command]
async fn space_preview(engine: tauri::State<'_, Arc<Engine>>, id: String) -> Result<sync::Preview, String> {
    let e = engine.inner().clone();
    tokio::task::spawn_blocking(move || e.space_preview(&id)).await.map_err(|x| x.to_string())
}

/// Ativa o espaço e dispara a 1ª rodada CONFIRMADA (permite apagar/baseline), em thread.
#[tauri::command]
fn space_activate(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.set_space_activated(&id, true).map_err(|e| format!("{e:#}"))?;
    let e = engine.inner().clone();
    std::thread::spawn(move || {
        if let Err(err) = e.confirmed_sync_one(&id) {
            tracing::error!("activate sync: {err:#}");
        }
    });
    Ok(())
}

/// Confirma uma rodada pendente (que apagaria) e a executa, em thread.
#[tauri::command]
fn space_confirm(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    let e = engine.inner().clone();
    std::thread::spawn(move || {
        if let Err(err) = e.confirmed_sync_one(&id) {
            tracing::error!("confirm sync: {err:#}");
        }
    });
    Ok(())
}

#[tauri::command]
fn space_pause(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.set_space_activated(&id, false).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn delete_space(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.delete_space(&id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn leave_space(engine: tauri::State<Arc<Engine>>, id: String) -> Result<(), String> {
    engine.leave_space(&id).map_err(|e| format!("{e:#}"))
}

/// Seletor nativo de pasta (Windows). Async p/ nao bloquear a thread principal.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|fp| fp.into_path().ok())
        .map(|pb| pb.to_string_lossy().to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Caminhos que NAO devem disparar sync.
fn is_noise_path(p: &std::path::Path) -> bool {
    let s = p.to_string_lossy().replace('/', "\\");
    [
        "\\.secrets\\",
        "\\.git\\",
        "\\node_modules\\",
        "\\target\\",
        "\\dist\\",
        "\\.karp-inspector\\",
    ]
    .iter()
    .any(|seg| s.contains(seg))
}

/// Watcher de filesystem multi-raiz.
fn spawn_watcher(engine: Arc<Engine>) {
    use std::sync::mpsc::RecvTimeoutError;
    std::thread::spawn(move || {
        use notify::{RecursiveMode, Watcher};
        loop {
            let generation = engine.watch_generation();
            let paths = engine.watch_paths();
            let (tx, rx) = std::sync::mpsc::channel();
            let mut watcher = match notify::recommended_watcher(move |res| {
                let _ = tx.send(res);
            }) {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("watcher init: {e}");
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };
            for p in &paths {
                if let Err(e) = watcher.watch(p, RecursiveMode::Recursive) {
                    tracing::warn!(?p, "watch falhou: {e}");
                }
            }
            tracing::info!(roots = paths.len(), "watcher (re)armado");
            loop {
                match rx.recv_timeout(Duration::from_secs(2)) {
                    Ok(Ok(ev)) => {
                        let mut real = false;
                        for p in &ev.paths {
                            if !is_noise_path(p) {
                                real = true;
                                engine.note_activity(p);
                            }
                        }
                        if real {
                            engine.mark_dirty();
                        }
                    }
                    Ok(Err(_)) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if engine.watch_generation() != generation {
                    break;
                }
            }
            if paths.is_empty() {
                std::thread::sleep(Duration::from_secs(3));
            }
        }
    });
}

fn spawn_sync_loop(engine: Arc<Engine>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        engine.tick();
    });
}

pub fn run_once() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();
    let engine = Engine::new();
    match engine.sync_once() {
        Ok(()) => {
            let s = engine.status();
            println!(
                "OK: estado={} mudancas={} conflitos={}",
                s.state,
                s.last_changes,
                s.conflicts.len()
            );
        }
        Err(e) => {
            eprintln!("FALHA: {e:#}");
            std::process::exit(1);
        }
    }
}

pub fn run_enforce_once() {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let engine = Engine::new();
    engine.startup_reconcile();
    println!("ENFORCE OK");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            {
                let mut cands: Vec<std::path::PathBuf> = Vec::new();
                if let Ok(rd) = app.path().resource_dir() {
                    cands.push(rd.join("resources").join("rclone.exe"));
                    cands.push(rd.join("rclone.exe"));
                }
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(d) = exe.parent() {
                        cands.push(d.join("rclone.exe"));
                        cands.push(d.join("resources").join("rclone.exe"));
                    }
                }
                if let Some(p) = cands.into_iter().find(|p| p.exists()) {
                    tracing::info!(?p, "rclone embutido");
                    std::env::set_var("SF_SYNC_RCLONE", p);
                }
            }

            use tauri_plugin_autostart::ManagerExt;
            if let Err(e) = app.autolaunch().enable() {
                tracing::warn!("autostart enable: {e}");
            }

            let engine = Arc::new(Engine::new());
            app.manage(engine.clone());
            spawn_watcher(engine.clone());
            spawn_sync_loop(engine.clone());
            {
                let eng = engine.clone();
                std::thread::spawn(move || eng.startup_reconcile());
            }

            let open = MenuItem::with_id(app, "open", "Abrir painel", true, None::<&str>)?;
            let sync_now_item =
                MenuItem::with_id(app, "sync_now", "Sincronizar agora", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sync_now_item, &quit])?;

            let _tray = TrayIconBuilder::with_id("sf-sync-tray")
                .tooltip("SF-Sync — ocioso")
                .icon(tauri::include_image!("icons/tray.png"))
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "sync_now" => {
                        if let Some(engine) = app.try_state::<Arc<Engine>>() {
                            let e = engine.inner().clone();
                            std::thread::spawn(move || {
                                if let Err(err) = e.sync_once() {
                                    tracing::error!("tray sync_now: {err:#}");
                                }
                            });
                        }
                    }
                    "quit" => {
                        if let Some(engine) = app.try_state::<Arc<Engine>>() {
                            engine.release_all();
                        }
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;

            if !std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_status,
            sync_now,
            is_paired,
            pair_device,
            list_spaces,
            list_invites,
            list_devices,
            revoke_device,
            accept_space,
            create_space,
            invite_to_space,
            create_invite_link,
            set_space_path,
            add_connection,
            list_connections,
            remove_connection,
            authorize_gdrive,
            google::google_login,
            space_preview,
            space_activate,
            space_confirm,
            space_pause,
            delete_space,
            leave_space,
            pick_folder,
            list_subfolders,
            unpair
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SF-Sync");
}
