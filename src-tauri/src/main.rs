#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod net;
mod queue;
mod routes;
mod server;
mod state;
mod submission;

use std::sync::Arc;

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tracing::{error, info};

use crate::state::AppState;

type SetupError = Box<dyn std::error::Error>;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            net::get_pairing_info,
            queue::list_waiting,
            queue::get_submission,
            queue::mark_entered
        ])
        .setup(|app| {
            if let Err(e) = init(app) {
                fatal(app.handle(), &e);
            }
            Ok(())
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
    app.manage(state);

    Ok(())
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
