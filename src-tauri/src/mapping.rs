//! Phase B8 — owner: the B8 agent. Do not edit from other phases.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::Value;
use tracing::warn;

const MAPPING_FILE: &str = "mapping.json";

/// The OSCAR field mapping, read from `mapping.json` beside the binary.
pub struct Mapping {
    path: PathBuf,
    state: Mutex<State>,
}

/// What a change to the file looks like from outside it: mtime and length
/// together. Two writes inside one filesystem timestamp tick share an mtime, and
/// on the mtime alone the second edit would never be read. `None` is a file that
/// is not there.
type Stamp = Option<(SystemTime, u64)>;

#[derive(Default)]
struct State {
    /// What the last read saw. `None` is also what a missing file stamps, so
    /// `read` records that a read happened at all.
    stamp: Stamp,
    read: bool,
    value: Option<Arc<Value>>,
}

impl Default for Mapping {
    fn default() -> Self {
        Self::new()
    }
}

impl Mapping {
    /// Resolves the file beside the executable and loads it. A missing or
    /// malformed file is not fatal — `current` reports it instead.
    pub fn new() -> Self {
        let path = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join(MAPPING_FILE)))
            .unwrap_or_else(|| PathBuf::from(MAPPING_FILE));

        let mapping = Self::at(path);
        // Load now so a clinic sees the warning in the startup log rather than
        // the first time the extension asks.
        let _ = mapping.current();
        mapping
    }

    /// The application always takes the file beside its executable; a test
    /// points one at a file of its own.
    pub(crate) fn at(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(State::default()),
        }
    }

    /// The last good version, re-read when the file on disk has changed.
    /// `None` only when nothing valid has ever been loaded.
    pub fn current(&self) -> Option<Arc<Value>> {
        let mut state = self.state.lock().unwrap();

        let stamp = stamp_of(&self.path);
        if !state.read || stamp != state.stamp {
            state.read = true;
            state.stamp = stamp;
            // A file that is malformed, or gone, leaves the previous value in
            // place: a clinic mid-edit should not stop the extension filling.
            if let Some(value) = read(&self.path) {
                state.value = Some(Arc::new(value));
            }
        }

        state.value.clone()
    }
}

fn stamp_of(path: &Path) -> Stamp {
    let meta = fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

fn read(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(e) => {
            warn!(error = %e, path = %path.display(), "mapping.json is not valid JSON");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("asmart-autofill-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join(MAPPING_FILE)
    }

    fn write(path: &Path, contents: &str) {
        fs::write(path, contents).unwrap();
        // Two writes in the same millisecond can share an mtime. The length in
        // the stamp is what covers that; the sleep keeps the ordinary tests
        // testing the ordinary path.
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    fn modified_of(path: &Path) -> SystemTime {
        fs::metadata(path).unwrap().modified().unwrap()
    }

    fn set_modified(path: &Path, at: SystemTime) {
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(at)
            .unwrap();
    }

    #[test]
    fn the_shipped_mapping_has_every_field() {
        let shipped: Value =
            serde_json::from_str(include_str!("../mapping.json")).expect("mapping.json is valid");
        assert_eq!(shipped["fields"].as_object().unwrap().len(), 13);
        assert!(shipped["save_button"].is_string());
    }

    #[test]
    fn a_missing_file_has_no_mapping() {
        let mapping = Mapping::at(temp_path("mapping-missing"));
        assert_eq!(mapping.current(), None);
    }

    #[test]
    fn an_edit_is_picked_up_without_a_restart() {
        let path = temp_path("mapping-edited");
        write(&path, r#"{"version":1}"#);
        let mapping = Mapping::at(path.clone());
        assert_eq!(mapping.current().unwrap()["version"], 1);

        write(&path, r#"{"version":2}"#);
        assert_eq!(mapping.current().unwrap()["version"], 2);
    }

    #[test]
    fn a_malformed_file_keeps_the_last_good_version() {
        let path = temp_path("mapping-malformed");
        write(&path, r#"{"version":1}"#);
        let mapping = Mapping::at(path.clone());
        assert_eq!(mapping.current().unwrap()["version"], 1);

        write(&path, "{ not json");
        assert_eq!(mapping.current().unwrap()["version"], 1);

        write(&path, r#"{"version":3}"#);
        assert_eq!(mapping.current().unwrap()["version"], 3);
    }

    /// An editor saving twice in one tick, or a copy that carries its source's
    /// timestamp, leaves the mtime where it was. The length is what notices.
    #[test]
    fn an_edit_the_clock_did_not_notice_is_still_picked_up() {
        let path = temp_path("mapping-same-tick");
        write(&path, r#"{"version":1}"#);
        let mapping = Mapping::at(path.clone());
        assert_eq!(mapping.current().unwrap()["version"], 1);

        let unchanged = modified_of(&path);
        write(&path, r#"{"version":22}"#);
        set_modified(&path, unchanged);
        assert_eq!(modified_of(&path), unchanged);

        assert_eq!(mapping.current().unwrap()["version"], 22);
    }

    /// Same reasoning as the malformed file: a clinic that has moved the file
    /// aside for a moment should not stop staff entering the patient in front
    /// of them.
    #[test]
    fn a_file_that_goes_missing_keeps_the_last_good_version() {
        let path = temp_path("mapping-removed");
        write(&path, r#"{"version":1}"#);
        let mapping = Mapping::at(path.clone());
        assert_eq!(mapping.current().unwrap()["version"], 1);

        fs::remove_file(&path).unwrap();
        assert_eq!(mapping.current().unwrap()["version"], 1);
    }

    #[test]
    fn a_malformed_file_on_the_first_read_has_no_mapping() {
        let path = temp_path("mapping-malformed-first");
        write(&path, "{ not json");
        assert_eq!(Mapping::at(path).current(), None);
    }
}
