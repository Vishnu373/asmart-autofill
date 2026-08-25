use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, Path, Request, State};
use axum::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN};
use axum::http::{HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use time::{Duration, OffsetDateTime};
use tracing::info;

use crate::state::AppState;

/// Any extension rather than one pinned id, because an unpacked build's id
/// follows the directory it was loaded from and nothing has pinned ours with a
/// manifest `key` yet.
///
/// This does not identify our extension, and cannot: its own requests carry no
/// `Origin` at all, so what passes here is every extension and every program on
/// the machine. What it does buy is the case worth buying — a page in a browser
/// tab always sends an `http(s)` origin, so a page cannot reach the queue.
/// Design, Trade-offs 8.
const EXTENSION_SCHEME: &str = "chrome-extension://";

/// How long a filled id is remembered, matching the queue's own retention:
/// past that the entry would have expired anyway, and `404` is the honest
/// answer.
const FILLED_MEMORY: Duration = Duration::hours(2);

/// The extension-facing routes. These carry their own loopback and origin
/// checks, so they are merged outside the tablet's bearer-token layer.
pub fn routes(state: Arc<AppState>) -> Router {
    let extension = Arc::new(Extension {
        app: state,
        filled: Mutex::new(Vec::new()),
    });

    Router::new()
        .route("/api/pending", get(pending))
        .route("/api/pending/{id}", get(details))
        .route("/api/pending/{id}/filled", post(filled))
        .route("/api/mapping", get(mapping))
        .with_state(extension)
        .layer(middleware::from_fn(guard))
}

struct Extension {
    app: Arc<AppState>,
    /// Ids the queue no longer holds because staff filled them. The queue drops
    /// an entry on `remove`, so without this "already filled" and "never
    /// existed" would be the same answer.
    filled: Mutex<Vec<(String, OffsetDateTime)>>,
}

impl Extension {
    fn was_filled(&self, id: &str) -> bool {
        let now = OffsetDateTime::now_utc();
        let mut filled = self.filled.lock().unwrap();
        filled.retain(|(_, at)| now - *at < FILLED_MEMORY);
        filled.iter().any(|(filled, _)| filled == id)
    }

    fn mark_filled(&self, id: &str) {
        self.filled
            .lock()
            .unwrap()
            .push((id.to_string(), OffsetDateTime::now_utc()));
    }

    /// `409` if we filled it, `404` otherwise — expired, or never real.
    fn gone(&self, id: &str) -> StatusCode {
        if self.was_filled(id) {
            StatusCode::CONFLICT
        } else {
            StatusCode::NOT_FOUND
        }
    }
}

/// Localhost only, and refused if it carries an origin that is not an
/// extension's. A page always sends `Origin` on a cross-origin fetch, so a page
/// on this machine cannot reach the queue; a service worker fetching a host it
/// has permission for may omit it, which is why an absent origin passes.
async fn guard(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    if !peer.ip().is_loopback() {
        return StatusCode::FORBIDDEN.into_response();
    }

    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if origin
        .as_deref()
        .is_some_and(|origin| !origin.starts_with(EXTENSION_SCHEME))
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut response = next.run(request).await;
    if let Some(origin) = origin.and_then(|origin| HeaderValue::from_str(&origin).ok()) {
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    response
}

async fn pending(State(extension): State<Arc<Extension>>) -> Response {
    Json(extension.app.queue().list()).into_response()
}

async fn details(State(extension): State<Arc<Extension>>, Path(id): Path<String>) -> Response {
    match extension.app.queue().get(&id) {
        Some(entry) => Json(entry.details).into_response(),
        None => extension.gone(&id).into_response(),
    }
}

async fn filled(State(extension): State<Arc<Extension>>, Path(id): Path<String>) -> Response {
    if !extension.app.queue().remove(&id) {
        return extension.gone(&id).into_response();
    }

    extension.mark_filled(&id);
    info!("{id} filled");
    StatusCode::OK.into_response()
}

/// Phase B8's route, here because it shares the guard above. No mapping means
/// no `mapping.json` beside the binary, which is a broken install rather than
/// anything the extension can act on.
async fn mapping(State(extension): State<Arc<Extension>>) -> Response {
    match extension.app.mapping().current() {
        Some(mapping) => Json(mapping).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;

    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use tower::ServiceExt;

    use crate::mapping::Mapping;
    use crate::submission::Submission;

    fn submission() -> Submission {
        Submission {
            first_name: "Jane".to_string(),
            last_name: "Doe".to_string(),
            preferred_name: None,
            address: "12 King St W".to_string(),
            city: "Toronto".to_string(),
            province: "ON".to_string(),
            postal_code: "M5H 1A1".to_string(),
            phone: "4165551234".to_string(),
            email: None,
            date_of_birth: "1985-04-17".to_string(),
            health_insurance_number: "1234567890".to_string(),
            health_insurance_version: None,
            hc_type: "ON".to_string(),
        }
    }

    /// The shipped router, so the guard under test is the real one.
    fn app() -> (Router, Arc<AppState>) {
        let state = AppState::new("secret".to_string());
        (crate::server::router(state.clone()), state)
    }

    /// The router carrying the real `mapping.json` — the file an install puts
    /// beside the executable, which `Mapping::new()` cannot find from a test
    /// binary.
    fn app_with_mapping(path: &str) -> Router {
        let state = AppState::with_mapping("secret".to_string(), Mapping::at(PathBuf::from(path)));
        crate::server::router(state)
    }

    const SHIPPED: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/mapping.json");

    /// `ConnectInfo` comes from the accept loop, which `oneshot` skips.
    fn request(method: &str, uri: &str, peer: [u8; 4], origin: Option<&str>) -> HttpRequest<Body> {
        let mut builder = HttpRequest::builder().method(method).uri(uri);
        if let Some(origin) = origin {
            builder = builder.header(ORIGIN, origin);
        }
        let mut request = builder.body(Body::empty()).unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((peer, 51000))));
        request
    }

    fn local(method: &str, uri: &str) -> HttpRequest<Body> {
        request(method, uri, [127, 0, 0, 1], None)
    }

    async fn send(router: Router, request: HttpRequest<Body>) -> (StatusCode, serde_json::Value) {
        let response = router.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    #[tokio::test]
    async fn the_waiting_list_carries_names_and_times_only() {
        let (router, state) = app();
        let id = state.queue().add(submission(), None);

        let (status, body) = send(router, local("GET", "/api/pending")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body[0]["id"], id);
        assert_eq!(body[0]["name"], "Jane Doe");
        assert!(body[0]["submitted_at"].is_string());
        assert!(body[0].get("phone").is_none());
    }

    #[tokio::test]
    async fn one_patient_comes_back_with_every_field() {
        let (router, state) = app();
        let id = state.queue().add(submission(), None);

        let (status, body) = send(router, local("GET", &format!("/api/pending/{id}"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["first_name"], "Jane");
        assert_eq!(body["health_insurance_number"], "1234567890");
    }

    #[tokio::test]
    async fn an_unknown_id_is_a_404() {
        let (router, _) = app();
        let (status, _) = send(router, local("GET", "/api/pending/beef")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn marking_filled_drops_the_entry_and_only_works_once() {
        let (router, state) = app();
        let id = state.queue().add(submission(), None);
        let uri = format!("/api/pending/{id}/filled");

        let (status, _) = send(router.clone(), local("POST", &uri)).await;
        assert_eq!(status, StatusCode::OK);
        assert!(state.queue().list().is_empty());

        let (status, _) = send(router.clone(), local("POST", &uri)).await;
        assert_eq!(status, StatusCode::CONFLICT);

        let (status, _) = send(router, local("GET", &format!("/api/pending/{id}"))).await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn a_request_arriving_on_the_lan_address_is_refused() {
        let (router, state) = app();
        state.queue().add(submission(), None);

        let request = request("GET", "/api/pending", [192, 168, 1, 20], None);
        let (status, _) = send(router, request).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn another_page_on_this_machine_is_refused() {
        let (router, _) = app();
        let request = request(
            "GET",
            "/api/pending",
            [127, 0, 0, 1],
            Some("http://localhost:3000"),
        );
        let (status, _) = send(router, request).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    const AN_EXTENSION: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

    #[tokio::test]
    async fn an_extension_origin_is_allowed_and_echoed_back() {
        let (router, _) = app();
        let request = request("GET", "/api/pending", [127, 0, 0, 1], Some(AN_EXTENSION));
        let response = router.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            AN_EXTENSION
        );
    }

    /// The service worker is expected to send no origin at all.
    #[tokio::test]
    async fn no_origin_at_all_is_allowed() {
        let (router, _) = app();
        let response = router.oneshot(local("GET", "/api/pending")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none()
        );
    }

    #[tokio::test]
    async fn an_origin_that_only_looks_like_an_extension_is_refused() {
        let (router, _) = app();
        let request = request(
            "GET",
            "/api/pending",
            [127, 0, 0, 1],
            Some("http://chrome-extension://x"),
        );
        let (status, _) = send(router, request).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn the_mapping_route_is_behind_the_guard() {
        let (router, _) = app();
        let request = request("GET", "/api/mapping", [192, 168, 1, 20], None);
        let (status, _) = send(router, request).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn the_mapping_beside_the_application_is_served() {
        let (status, body) = send(app_with_mapping(SHIPPED), local("GET", "/api/mapping")).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["emr"], "oscar");
        assert!(body["save_button"].is_string());
    }

    /// A renamed key is invisible to a count of thirteen, and `fill.ts` looks a
    /// selector up by the submission's own field name — so the two sets of names
    /// have to be the same set, not the same size.
    #[tokio::test]
    async fn the_served_mapping_names_every_field_a_submission_carries() {
        let (status, body) = send(app_with_mapping(SHIPPED), local("GET", "/api/mapping")).await;
        assert_eq!(status, StatusCode::OK);

        let carried = serde_json::to_value(submission()).unwrap();
        let carried = carried.as_object().unwrap();
        let fields = body["fields"].as_object().unwrap();

        for name in carried.keys() {
            assert!(
                fields.contains_key(name),
                "mapping.json has no selector for {name}"
            );
        }
        assert_eq!(fields.len(), carried.len());
    }

    /// The `500` the extension reads as "this install has no field list".
    #[tokio::test]
    async fn no_mapping_beside_the_application_is_a_500() {
        let router = app_with_mapping("no-such-mapping.json");
        let (status, _) = send(router, local("GET", "/api/mapping")).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
