use std::io;
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::Path;
use std::sync::Arc;

use axum::{Json, Router, middleware, routing::get};
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

use crate::auth;
use crate::routes::tablet;
use crate::state::AppState;

const PREFERRED_PORT: u16 = 8787;
const PORT_ATTEMPTS: u16 = 10;

pub fn init_logging(log_dir: &Path) -> io::Result<WorkerGuard> {
    std::fs::create_dir_all(log_dir)?;
    let (writer, guard) =
        tracing_appender::non_blocking(tracing_appender::rolling::daily(log_dir, "app.log"));

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(io::stdout))
        .with(fmt::layer().with_ansi(false).with_writer(writer))
        .init();

    Ok(guard)
}

/// Returns the port that was bound, so the caller can say so in one line.
pub fn start(state: &Arc<AppState>) -> io::Result<u16> {
    let listener = bind()?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;

    let (tx, rx) = oneshot::channel();
    state.set_port(port);
    state.set_shutdown(tx);

    let router = router(state.clone());

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(e) => {
                error!(error = %e, "could not hand the listener to tokio");
                return;
            }
        };

        let served = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = rx.await;
        })
        .await;

        match served {
            Ok(()) => info!("server stopped"),
            Err(e) => error!(error = %e, "server stopped with an error"),
        }
    });

    Ok(port)
}

pub(crate) fn router(state: Arc<AppState>) -> Router {
    // Health stays open: the tablet uses it to tell "front desk asleep" from
    // "form broken", before it has anything else.
    Router::new()
        .route("/api/health", get(health))
        .merge(crate::routes::extension::routes(state.clone()))
        .merge(tablet_routes(state))
}

/// The tablet-facing group. Routes must be added *above* the `layer` call —
/// axum only applies a layer to the routes already on the router, and the last
/// layer added is the outermost, so the rate limit runs before the token check.
/// The form is merged in after both because it carries its own gate: a browser
/// opening the QR's URL cannot send a bearer header.
fn tablet_routes(state: Arc<AppState>) -> Router {
    crate::routes::tablet::routes(state.clone())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_token,
        ))
        .layer(middleware::from_fn_with_state(
            tablet::Limiter::new(),
            tablet::rate_limit,
        ))
        .merge(crate::routes::tablet::form_route(state))
}

/// Answers before the token is checked, so it says only that something is
/// listening. Anything more is told to a caller that has proved nothing.
async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// Only the last failure survives the loop, so each one is logged with its port
/// as it happens — otherwise a run where every port was refused reports a bare
/// OS message with nothing to act on.
fn bind() -> io::Result<TcpListener> {
    let last_port = PREFERRED_PORT + PORT_ATTEMPTS - 1;
    let mut last = None;

    for port in PREFERRED_PORT..=last_port {
        match TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)) {
            Ok(listener) => return Ok(listener),
            Err(e) => {
                warn!(port, error = %e, "port unavailable");
                last = Some(e);
            }
        }
    }

    Err(match last {
        Some(e) => io::Error::new(
            e.kind(),
            format!("no free port in {PREFERRED_PORT}..={last_port}: {e}"),
        ),
        None => io::Error::other(format!(
            "no port attempted in {PREFERRED_PORT}..={last_port}"
        )),
    })
}
