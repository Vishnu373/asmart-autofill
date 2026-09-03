use std::cmp::Reverse;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use tracing::info;

use crate::state::AppState;
use crate::submission::Submission;

pub const QUEUE_CHANGED: &str = "queue-changed";

const RETENTION: Duration = Duration::hours(2);
const SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Clone, Debug)]
pub struct Entry {
    pub id: String,
    pub details: Submission,
    pub submitted_at: OffsetDateTime,
}

#[derive(Clone, Debug, Serialize)]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub submitted_at: String,
}

struct Record {
    entry: Entry,
    idempotency_key: Option<String>,
}

#[derive(Default)]
pub struct Queue {
    records: Mutex<Vec<Record>>,
    on_change: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl Queue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_on_change(&self, notify: impl Fn() + Send + Sync + 'static) {
        *self.on_change.lock().unwrap() = Some(Box::new(notify));
    }

    fn changed(&self) {
        if let Some(notify) = self.on_change.lock().unwrap().as_ref() {
            notify();
        }
    }

    pub fn add(&self, details: Submission, idempotency_key: Option<&str>) -> String {
        self.add_at(details, idempotency_key, OffsetDateTime::now_utc())
    }

    pub fn add_at(
        &self,
        details: Submission,
        idempotency_key: Option<&str>,
        now: OffsetDateTime,
    ) -> String {
        let mut records = self.records.lock().unwrap();

        if let Some(key) = idempotency_key
            && let Some(seen) = records
                .iter()
                .find(|record| record.idempotency_key.as_deref() == Some(key))
        {
            return seen.entry.id.clone();
        }

        let id = loop {
            let id = generate_id();
            if !records.iter().any(|record| record.entry.id == id) {
                break id;
            }
        };

        records.push(Record {
            entry: Entry {
                id: id.clone(),
                details,
                submitted_at: now,
            },
            idempotency_key: idempotency_key.map(str::to_string),
        });
        drop(records);

        self.changed();
        id
    }

    pub fn list(&self) -> Vec<Summary> {
        let records = self.records.lock().unwrap();
        let mut entries: Vec<_> = records.iter().map(|record| &record.entry).collect();
        entries.sort_by_key(|entry| Reverse(entry.submitted_at));
        entries
            .into_iter()
            .map(|entry| Summary {
                id: entry.id.clone(),
                name: format!(
                    "{} {}",
                    entry.details.first_name.trim(),
                    entry.details.last_name.trim()
                ),
                submitted_at: format_utc(entry.submitted_at),
            })
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<Entry> {
        let records = self.records.lock().unwrap();
        records
            .iter()
            .find(|record| record.entry.id == id)
            .map(|record| record.entry.clone())
    }

    pub fn remove(&self, id: &str) -> bool {
        let mut records = self.records.lock().unwrap();
        let before = records.len();
        records.retain(|record| record.entry.id != id);
        let removed = records.len() != before;
        drop(records);

        if removed {
            self.changed();
        }
        removed
    }

    pub fn sweep(&self, now: OffsetDateTime) -> usize {
        let mut records = self.records.lock().unwrap();
        let before = records.len();
        records.retain(|record| now - record.entry.submitted_at < RETENTION);
        let dropped = before - records.len();
        drop(records);

        if dropped > 0 {
            self.changed();
        }
        dropped
    }
}

fn format_utc(at: OffsetDateTime) -> String {
    at.replace_nanosecond(0)
        .unwrap_or(at)
        .to_offset(time::UtcOffset::UTC)
        .format(&Rfc3339)
        .expect("RFC 3339 can represent any OffsetDateTime")
}

fn generate_id() -> String {
    let mut bytes = [0u8; 2];
    getrandom::fill(&mut bytes).expect("system randomness is unavailable");
    format!("{:02x}{:02x}", bytes[0], bytes[1])
}

#[tauri::command]
pub fn list_waiting(state: State<'_, Arc<AppState>>) -> Vec<Summary> {
    state.queue().list()
}

#[tauri::command]
pub fn get_submission(state: State<'_, Arc<AppState>>, id: String) -> Option<Submission> {
    state.queue().get(&id).map(|entry| entry.details)
}

#[tauri::command]
pub fn mark_entered(state: State<'_, Arc<AppState>>, id: String) -> bool {
    let removed = state.queue().remove(&id);
    if removed {
        info!("{id} entered");
    }
    removed
}

pub fn spawn_sweeper(queue: Arc<Queue>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            ticker.tick().await;
            let dropped = queue.sweep(OffsetDateTime::now_utc());
            if dropped > 0 {
                tracing::info!(dropped, "dropped expired submissions");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use time::macros::datetime;

    fn submission(first_name: &str, last_name: &str) -> Submission {
        Submission {
            first_name: first_name.to_string(),
            last_name: last_name.to_string(),
            preferred_name: None,
            address: "1 Main St".to_string(),
            city: "Montreal".to_string(),
            province: "QC".to_string(),
            postal_code: "H2X 1Y4".to_string(),
            phone: "5145550123".to_string(),
            email: None,
            date_of_birth: "1990-01-01".to_string(),
            health_insurance_number: "DOEJ 9001 0112".to_string(),
            health_insurance_version: None,
            hc_type: "QC".to_string(),
        }
    }

    #[test]
    fn an_added_entry_can_be_listed_and_read_back() {
        let queue = Queue::new();
        let id = queue.add(submission("Jane", "Doe"), None);

        let listed = queue.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].name, "Jane Doe");
        assert_eq!(queue.get(&id).unwrap().details.first_name, "Jane");
    }

    #[test]
    fn a_listed_name_carries_no_stray_spacing() {
        let queue = Queue::new();
        queue.add(submission("  Jane ", " Doe  "), None);
        assert_eq!(queue.list()[0].name, "Jane Doe");
    }

    #[test]
    fn ids_are_short_and_distinct() {
        let queue = Queue::new();
        let first = queue.add(submission("Jane", "Doe"), None);
        let second = queue.add(submission("John", "Roe"), None);

        assert_eq!(first.len(), 4);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn the_list_is_newest_first() {
        let queue = Queue::new();
        let older = queue.add_at(
            submission("Jane", "Doe"),
            None,
            datetime!(2026-08-13 14:00 UTC),
        );
        let newer = queue.add_at(
            submission("John", "Roe"),
            None,
            datetime!(2026-08-13 14:12 UTC),
        );

        let ids: Vec<_> = queue.list().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![newer, older]);
    }

    #[test]
    fn times_are_rfc_3339_utc_to_the_second() {
        let queue = Queue::new();
        queue.add_at(
            submission("Jane", "Doe"),
            None,
            datetime!(2026-08-13 14:12:04.5 UTC),
        );

        assert_eq!(queue.list()[0].submitted_at, "2026-08-13T14:12:04Z");
    }

    #[test]
    fn submitting_twice_with_the_same_key_yields_one_entry() {
        let queue = Queue::new();
        let first = queue.add(submission("Jane", "Doe"), Some("abc"));
        let second = queue.add(submission("Jane", "Doe"), Some("abc"));

        assert_eq!(first, second);
        assert_eq!(queue.list().len(), 1);
    }

    #[test]
    fn different_keys_are_different_entries() {
        let queue = Queue::new();
        let first = queue.add(submission("Jane", "Doe"), Some("abc"));
        let second = queue.add(submission("Jane", "Doe"), Some("xyz"));

        assert_ne!(first, second);
        assert_eq!(queue.list().len(), 2);
    }

    #[test]
    fn only_a_real_change_is_announced() {
        let queue = Queue::new();
        let changes = Arc::new(AtomicUsize::new(0));
        let counter = changes.clone();
        queue.set_on_change(move || {
            counter.fetch_add(1, Ordering::Relaxed);
        });
        let submitted = datetime!(2026-08-13 14:12:04 UTC);

        let id = queue.add_at(submission("Jane", "Doe"), Some("abc"), submitted);
        queue.add_at(submission("Jane", "Doe"), Some("abc"), submitted);
        assert_eq!(changes.load(Ordering::Relaxed), 1);

        assert!(queue.remove(&id));
        assert!(!queue.remove(&id));
        assert_eq!(changes.load(Ordering::Relaxed), 2);

        queue.add_at(submission("John", "Roe"), None, submitted);
        queue.sweep(submitted + Duration::hours(3));
        queue.sweep(submitted + Duration::hours(3));
        assert_eq!(changes.load(Ordering::Relaxed), 4);
    }

    #[test]
    fn removing_takes_the_entry_out_and_only_works_once() {
        let queue = Queue::new();
        let id = queue.add(submission("Jane", "Doe"), None);

        assert!(queue.remove(&id));
        assert!(!queue.remove(&id));
        assert!(queue.get(&id).is_none());
        assert!(queue.list().is_empty());
    }

    #[test]
    fn an_entry_older_than_two_hours_is_swept() {
        let queue = Queue::new();
        let submitted = datetime!(2026-08-13 14:12:04 UTC);
        let aged = queue.add_at(submission("Jane", "Doe"), None, submitted);
        let fresh = queue.add_at(
            submission("John", "Roe"),
            None,
            submitted + Duration::minutes(90),
        );

        assert_eq!(queue.sweep(submitted + Duration::hours(2)), 1);
        assert!(queue.get(&aged).is_none());
        assert!(queue.get(&fresh).is_some());
    }

    #[test]
    fn a_swept_entrys_idempotency_key_stops_being_honoured() {
        let queue = Queue::new();
        let submitted = datetime!(2026-08-13 14:12:04 UTC);
        let first = queue.add_at(submission("Jane", "Doe"), Some("abc"), submitted);

        queue.sweep(submitted + Duration::hours(3));
        let second = queue.add_at(
            submission("Jane", "Doe"),
            Some("abc"),
            submitted + Duration::hours(3),
        );

        assert_ne!(first, second);
        assert_eq!(queue.list().len(), 1);
    }
}
