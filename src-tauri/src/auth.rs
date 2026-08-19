use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{StatusCode, header::AUTHORIZATION};
use axum::middleware::Next;
use axum::response::Response;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use subtle::ConstantTimeEq;

use crate::state::AppState;

const TOKEN_FILE: &str = "pairing-token";
const TOKEN_BYTES: usize = 32;

/// Read the pairing token from the app config dir, generating and persisting
/// one on first run. Reusing it keeps the tablet's bookmarked URL valid.
pub fn load_or_create(config_dir: &Path) -> io::Result<String> {
    let path = config_dir.join(TOKEN_FILE);

    if let Some(existing) = read_existing(&path)? {
        return Ok(existing);
    }

    fs::create_dir_all(config_dir)?;
    let token = generate();
    write_private(&path, &token)?;
    Ok(token)
}

/// `None` means there is nothing usable on disk and a new token should be
/// written. A read error other than "no such file" is propagated instead:
/// the file may hold a perfectly good token we simply could not see this
/// start, and the write below would truncate it.
fn read_existing(path: &Path) -> io::Result<Option<String>> {
    let existing = match fs::read_to_string(path) {
        Ok(existing) => existing,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };

    let existing = existing.trim();
    Ok(is_well_formed(existing).then(|| existing.to_string()))
}

/// A partial write leaves a short but non-empty file, so length alone is not
/// enough — the stored value has to decode back to a full 32 bytes.
fn is_well_formed(token: &str) -> bool {
    URL_SAFE_NO_PAD
        .decode(token)
        .is_ok_and(|bytes| bytes.len() == TOKEN_BYTES)
}

fn generate() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).expect("system randomness is unavailable");
    URL_SAFE_NO_PAD.encode(bytes)
}

fn write_private(path: &Path, token: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(token.as_bytes())
}

/// Rejects any tablet-facing request that does not carry the pairing token.
pub async fn require_token(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let presented = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    match presented {
        Some(token) if matches(token, state.token()) => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn matches(presented: &str, expected: &str) -> bool {
    let presented = presented.as_bytes();
    let expected = expected.as_bytes();
    presented.len() == expected.len() && presented.ct_eq(expected).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use axum::routing::get;
    use axum::{Router, middleware};
    use tower::ServiceExt;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("asmart-autofill-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn guarded(state: Arc<AppState>) -> Router {
        Router::new()
            .route("/api/guarded", get(|| async { "ok" }))
            .route_layer(middleware::from_fn_with_state(state, require_token))
    }

    async fn status_for(token: Option<&str>) -> StatusCode {
        let state = AppState::new("secret".to_string());
        let mut request = HttpRequest::builder().uri("/api/guarded");
        if let Some(token) = token {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        guarded(state)
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[test]
    fn generates_a_url_safe_token() {
        let token = generate();
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_eq!(URL_SAFE_NO_PAD.decode(&token).unwrap().len(), TOKEN_BYTES);
    }

    #[test]
    fn the_same_token_comes_back_on_the_next_run() {
        let dir = temp_dir("token-persists");
        let first = load_or_create(&dir).unwrap();
        let second = load_or_create(&dir).unwrap();
        assert_eq!(first, second);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_blank_token_file_is_replaced() {
        let dir = temp_dir("token-blank");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(TOKEN_FILE), "   ").unwrap();
        assert!(!load_or_create(&dir).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_truncated_token_file_is_replaced() {
        let dir = temp_dir("token-truncated");
        fs::create_dir_all(&dir).unwrap();
        let truncated = &generate()[..6];
        fs::write(dir.join(TOKEN_FILE), truncated).unwrap();

        let loaded = load_or_create(&dir).unwrap();
        assert_ne!(loaded, truncated);
        assert!(is_well_formed(&loaded));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_token_file_asks_for_a_new_one() {
        let dir = temp_dir("token-missing");
        assert_eq!(read_existing(&dir.join(TOKEN_FILE)).unwrap(), None);
    }

    #[test]
    fn an_unreadable_token_file_is_an_error_not_a_new_token() {
        let dir = temp_dir("token-unreadable");
        let path = dir.join(TOKEN_FILE);
        fs::create_dir_all(&path).unwrap();

        assert!(read_existing(&path).is_err());
        assert!(load_or_create(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compares_exactly() {
        assert!(matches("abc", "abc"));
        assert!(!matches("abc", "abd"));
        assert!(!matches("abc", "abcd"));
        assert!(!matches("", "abc"));
    }

    #[tokio::test]
    async fn a_request_without_the_token_is_refused() {
        assert_eq!(status_for(None).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_request_with_the_wrong_token_is_refused() {
        assert_eq!(status_for(Some("wrong")).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_request_with_the_token_is_allowed() {
        assert_eq!(status_for(Some("secret")).await, StatusCode::OK);
    }
}
