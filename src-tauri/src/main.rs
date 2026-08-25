#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod mapping;
mod net;
mod queue;
mod routes;
mod server;
mod state;
mod submission;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
#[cfg(not(debug_assertions))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tracing::{error, info};

use crate::state::AppState;

type SetupError = Box<dyn std::error::Error>;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            net::get_pairing_info,
            queue::get_waiting_count
        ])
        .setup(|app| {
            if let Err(e) = init(app) {
                fatal(app.handle(), &e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start asmart-autofill");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            info!("shutting down");
            if let Some(state) = app.try_state::<Arc<AppState>>() {
                state.shutdown();
            }
        }
    });
}

fn init(app: &mut tauri::App) -> Result<(), SetupError> {
    let log_dir = app.path().app_log_dir()?;
    let guard = server::init_logging(&log_dir)?;
    app.manage(guard);

    #[cfg(not(debug_assertions))]
    enable_autostart(app);

    let token = auth::load_or_create(&app.path().app_config_dir()?)?;
    let state = AppState::new(token);
    let address = net::detect();
    state.set_address(address);
    let port = server::start(&state)?;
    info!(?address, port, "started");
    queue::spawn_sweeper(state.queue().clone());
    let handle = app.handle().clone();
    state.queue().set_on_change(move || {
        let _ = handle.emit(queue::QUEUE_CHANGED, ());
    });
    net::watch(app.handle().clone(), state.clone());
    app.manage(state.clone());

    let tooltip = match state.port() {
        Some(port) => format!("asmart-autofill — port {port}"),
        None => "asmart-autofill".to_string(),
    };

    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let icon = app
        .default_window_icon()
        .ok_or("the bundle has no window icon")?
        .clone();

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip(&tooltip)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Written once, on the first run that finds it unset. Re-registering on every
/// launch would put back an entry the user removed in Task Manager, and a debug
/// build would register a path under `target/` that a `cargo clean` deletes.
#[cfg(not(debug_assertions))]
fn enable_autostart(app: &tauri::App) {
    let autostart = app.autolaunch();
    match autostart.is_enabled() {
        Ok(true) => {}
        Ok(false) => {
            if let Err(e) = autostart.enable() {
                error!(error = %e, "could not enable autostart");
            }
        }
        Err(e) => error!(error = %e, "could not read autostart state"),
    }
}

/// A release build has no console, so a startup failure that only panics is
/// invisible. Say it in the log, then in a box the front desk cannot miss.
fn fatal(app: &tauri::AppHandle, e: &SetupError) -> ! {
    error!(error = %e, "startup failed");

    app.dialog()
        .message(format!(
            "asmart-autofill could not start.\n\n{e}\n\nThe log is in {}",
            app.path()
                .app_log_dir()
                .map(|dir| dir.display().to_string())
                .unwrap_or_else(|_| "the app data folder".to_string())
        ))
        .title("asmart-autofill")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();

    std::process::exit(1);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
