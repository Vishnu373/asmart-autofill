use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::rejection::JsonRejection;
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;
use tracing::{info, warn};

use crate::state::AppState;
use crate::submission::Submission;

const RATE_WINDOW: Duration = Duration::from_secs(60);
const RATE_LIMIT: u32 = 10;
const IDEMPOTENCY_KEY: &str = "idempotency-key";

/// The whole form, script and styles inlined by `vite-plugin-singlefile`, so
/// the tablet makes no follow-up asset request that would need its own gate.
/// Built by `bun run --filter '@asmart/form' build`.
const FORM: &str = include_str!("../../../apps/form/dist/index.html");

/// The routes behind the bearer gate `server::tablet_routes` applies.
pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/submissions", post(submit))
        .with_state(state)
}

/// The form itself, which gates on the query token instead — see `form`.
pub fn form_route(state: Arc<AppState>) -> Router {
    Router::new().route("/", get(form)).with_state(state)
}

/// One counter per address, holding a fixed window from its first request.
#[derive(Default)]
pub struct Limiter {
    windows: Mutex<HashMap<IpAddr, Window>>,
}

struct Window {
    started: Instant,
    count: u32,
}

impl Limiter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// How many requests this address has made in the current window, this one
    /// included. The caller compares it, so a refusal can log what it saw.
    fn count(&self, addr: IpAddr) -> u32 {
        let now = Instant::now();
        let mut windows = self.windows.lock().unwrap();

        // Leases move, so addresses accumulate. Finished windows are dead
        // weight and dropping them keeps the map to the tablets in the room.
        windows.retain(|_, window| now.duration_since(window.started) < RATE_WINDOW);

        let window = windows.entry(addr).or_insert(Window {
            started: now,
            count: 0,
        });
        window.count += 1;
        window.count
    }
}

/// Layered outside the bearer gate on the API routes, so a caller holding no
/// token at all is throttled too. `form_route` is merged after both layers
/// (`server.rs`) and so is not throttled: its token is 32 random bytes.
pub async fn rate_limit(
    State(limiter): State<Arc<Limiter>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let count = limiter.count(peer.ip());
    if count > RATE_LIMIT {
        warn!(ip = %peer.ip(), count, limit = RATE_LIMIT, "submission failed");
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    next.run(request).await
}

async fn submit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Result<Json<Submission>, JsonRejection>,
) -> Response {
    let details = match body {
        Ok(Json(details)) => details,
        Err(e) => {
            let text = e.body_text();
            warn!(field = field_in(&text), "submission failed");
            return invalid("body", text);
        }
    };

    if let Err(e) = details.validate() {
        warn!(field = e.field, reason = %e.reason, "submission failed");
        return invalid(e.field, e.reason);
    }

    let key = headers
        .get(IDEMPOTENCY_KEY)
        .and_then(|value| value.to_str().ok());
    let id = state.queue().add(details, key);

    info!("{id} received");
    (StatusCode::CREATED, Json(json!({ "id": id }))).into_response()
}

/// The prefix axum puts in front of serde's own message when the body parsed as
/// JSON but did not fit `Submission`.
const DATA_ERROR: &str = "Failed to deserialize the JSON body into the target type: ";

/// The field a rejection is about, and nothing else from that message: serde
/// quotes the offending value back, and here that value is a patient's. The log
/// file outlives the queue, so only the name is safe to keep. Anything not
/// shaped like a field name is reported as unknown rather than guessed at.
fn field_in(message: &str) -> &str {
    let Some(detail) = message.strip_prefix(DATA_ERROR) else {
        return "unknown";
    };

    let name = match detail.strip_prefix("missing field `") {
        Some(rest) => rest.split('`').next().unwrap_or_default(),
        None => detail.split(": ").next().unwrap_or_default(),
    };

    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        name
    } else {
        "unknown"
    }
}

fn invalid(field: &str, reason: String) -> Response {
    let body = Json(json!({ "field": field, "reason": reason }));
    (StatusCode::BAD_REQUEST, body).into_response()
}

#[derive(Deserialize)]
struct Pairing {
    t: Option<String>,
}

/// The QR is opened by navigating the tablet's browser, which cannot send a
/// bearer header, so this one route takes the token as `?t=` instead.
async fn form(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(pairing): Query<Pairing>,
) -> Response {
    match pairing.t {
        Some(token) if matches(&token, state.token()) => {
            info!(ip = %peer.ip(), "form served");
            Html(FORM).into_response()
        }
        present => {
            let token = if present.is_some() {
                "wrong"
            } else {
                "missing"
            };
            warn!(ip = %peer.ip(), token, "form refused");
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

/// `auth`'s equivalent is private to it; this is the same constant-time compare
/// after a length check, since the length is not a secret.
fn matches(presented: &str, expected: &str) -> bool {
    let presented = presented.as_bytes();
    let expected = expected.as_bytes();
    presented.len() == expected.len() && presented.ct_eq(expected).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    use axum::body::Body;
    use axum::http::{Request, header::AUTHORIZATION};
    use tower::ServiceExt;

    const VALID: &str = r#"{
        "first_name": "Jane", "last_name": "Doe", "preferred_name": "Janie",
        "address": "12 King St W", "city": "Toronto",
        "province": "ON", "postal_code": "M5H 1A1",
        "phone": "4165551234", "email": "jane@example.com",
        "date_of_birth": "1985-04-17",
        "health_insurance_number": "1234567890",
        "health_insurance_version": "AB",
        "hc_type": "ON"
    }"#;

    /// The shipped router, so the token gate under test is the real one.
    fn app() -> Router {
        crate::server::router(AppState::new("secret".to_string()))
    }

    /// `ConnectInfo` comes from the accept loop, which `oneshot` skips.
    fn request(builder: axum::http::request::Builder, body: &'static str) -> Request<Body> {
        let mut request = builder.body(Body::from(body)).unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([192, 168, 1, 20], 51000))));
        request
    }

    fn post_submission(token: Option<&str>, body: &'static str) -> Request<Body> {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/api/submissions")
            .header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        request(builder, body)
    }

    async fn send(router: Router, request: Request<Body>) -> (StatusCode, serde_json::Value) {
        let response = router.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    #[tokio::test]
    async fn a_valid_submission_is_queued() {
        let (status, body) = send(app(), post_submission(Some("secret"), VALID)).await;
        assert_eq!(status, StatusCode::CREATED);
        assert!(body["id"].as_str().is_some_and(|id| !id.is_empty()));
    }

    #[tokio::test]
    async fn a_submission_that_fails_validation_names_the_field() {
        let body = r#"{
            "first_name": "", "last_name": "Doe", "preferred_name": null,
            "address": "12 King St W", "city": "Toronto",
            "province": "ON", "postal_code": "M5H 1A1",
            "phone": "4165551234", "email": null,
            "date_of_birth": "1985-04-17",
            "health_insurance_number": "1234567890",
            "health_insurance_version": null,
            "hc_type": "ON"
        }"#;
        let (status, body) = send(app(), post_submission(Some("secret"), body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["field"], "first_name");
    }

    #[tokio::test]
    async fn a_submission_missing_a_field_is_also_a_400() {
        let (status, _) = send(
            app(),
            post_submission(Some("secret"), r#"{"first_name":"Jane"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_submission_without_the_token_is_refused() {
        let (status, _) = send(app(), post_submission(None, VALID)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_submission_with_the_wrong_token_is_refused() {
        let (status, _) = send(app(), post_submission(Some("wrong"), VALID)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn too_many_submissions_from_one_address_are_refused() {
        let router = app();
        for _ in 0..RATE_LIMIT {
            let (status, _) = send(router.clone(), post_submission(Some("secret"), VALID)).await;
            assert_eq!(status, StatusCode::CREATED);
        }

        let (status, _) = send(router, post_submission(Some("secret"), VALID)).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn an_unauthenticated_flood_is_also_refused() {
        let router = app();
        for _ in 0..RATE_LIMIT {
            let (status, _) = send(router.clone(), post_submission(None, VALID)).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        }

        let (status, _) = send(router, post_submission(None, VALID)).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn a_rejection_yields_the_field_name_and_never_the_value() {
        let typed = format!(
            "{DATA_ERROR}date_of_birth: invalid type: integer `19850417`, expected a string at line 1 column 40"
        );
        assert_eq!(field_in(&typed), "date_of_birth");

        let missing = format!("{DATA_ERROR}missing field `postal_code` at line 1 column 20");
        assert_eq!(field_in(&missing), "postal_code");
    }

    #[test]
    fn a_rejection_about_no_particular_field_is_unknown() {
        assert_eq!(
            field_in("Failed to parse the request body as JSON"),
            "unknown"
        );

        let whole_body = format!("{DATA_ERROR}invalid type: sequence, expected a map");
        assert_eq!(field_in(&whole_body), "unknown");
    }

    #[tokio::test]
    async fn the_form_is_served_to_a_browser_carrying_the_token() {
        let request = request(Request::builder().uri("/?t=secret"), "");
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        // Catches a form bundle that was never built or came out empty.
        assert!(FORM.contains("<div id=\"root\">"));
    }

    #[tokio::test]
    async fn the_form_is_refused_without_the_token() {
        for uri in ["/", "/?t=wrong"] {
            let request = request(Request::builder().uri(uri), "");
            let response = app().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}
