use std::cmp::Reverse;
use std::io;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tracing::{error, info};

use crate::state::AppState;
use crate::store::Store;
use crate::submission::Submission;

pub const QUEUE_CHANGED: &str = "queue-changed";

/// One patient, from the moment they press Submit until a staff member deletes
/// them. Nothing here expires on its own.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    pub details: Submission,
    #[serde(with = "time::serde::rfc3339")]
    pub submitted_at: OffsetDateTime,
    /// When staff copied it into the EMR. Entering and deleting are separate
    /// now, so an entered record stays on disk until someone removes it.
    #[serde(with = "time::serde::rfc3339::option", default)]
    pub entered_at: Option<OffsetDateTime>,
    pub idempotency_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub submitted_at: String,
    pub entered_at: Option<String>,
}

#[derive(Default)]
pub struct Queue {
    records: Mutex<Vec<Record>>,
    on_change: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    /// Absent in tests, which have no business writing to a disk.
    store: Option<Store>,
}

impl Queue {
    /// In-memory only, and so only ever what a test wants — the application
    /// always goes through `restored`.
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Startup: pick up whatever the last run left behind. A store that will
    /// not read is an error rather than an empty queue, because the first write
    /// after that would replace patients nobody has entered yet.
    pub fn restored(store: Store) -> io::Result<Self> {
        let records = store.load()?;
        info!(records = records.len(), "store loaded");
        Ok(Self {
            records: Mutex::new(records),
            on_change: Mutex::new(None),
            store: Some(store),
        })
    }

    pub fn set_on_change(&self, notify: impl Fn() + Send + Sync + 'static) {
        *self.on_change.lock().unwrap() = Some(Box::new(notify));
    }

    fn changed(&self) {
        if let Some(notify) = self.on_change.lock().unwrap().as_ref() {
            notify();
        }
    }

    /// Called holding the lock, so two writes cannot interleave into one file.
    fn write(&self, records: &[Record]) -> io::Result<()> {
        match &self.store {
            Some(store) => store.save(records),
            None => Ok(()),
        }
    }

    /// For a change that adds something. A failure is logged and swallowed: the
    /// record is already in memory, and turning a patient away over a disk fault
    /// the front desk cannot fix is worse than running until someone reads the
    /// log. Deletion cannot borrow this reasoning — see `delete`.
    fn persist(&self, records: &[Record]) {
        if let Err(e) = self.write(records) {
            error!(error = %e, "store write failed");
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
            return seen.id.clone();
        }

        let id = loop {
            let id = generate_id();
            if !records.iter().any(|record| record.id == id) {
                break id;
            }
        };

        records.push(Record {
            id: id.clone(),
            details,
            submitted_at: now,
            entered_at: None,
            idempotency_key: idempotency_key.map(str::to_string),
        });
        self.persist(&records);
        drop(records);

        self.changed();
        id
    }

    /// Everything held, newest first. Entered and not-yet-entered are told
    /// apart by `entered_at` rather than by being in different lists, so the
    /// window decides how to group them.
    pub fn list(&self) -> Vec<Summary> {
        let records = self.records.lock().unwrap();
        let mut sorted: Vec<_> = records.iter().collect();
        sorted.sort_by_key(|record| Reverse(record.submitted_at));
        sorted
            .into_iter()
            .map(|record| Summary {
                id: record.id.clone(),
                name: format!(
                    "{} {}",
                    record.details.first_name.trim(),
                    record.details.last_name.trim()
                ),
                submitted_at: format_utc(record.submitted_at),
                entered_at: record.entered_at.map(format_utc),
            })
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<Record> {
        let records = self.records.lock().unwrap();
        records.iter().find(|record| record.id == id).cloned()
    }

    pub fn mark_entered(&self, id: &str) -> bool {
        self.mark_entered_at(id, OffsetDateTime::now_utc())
    }

    /// False only when the record has gone — deleted from another look. Marking
    /// twice keeps the first time, which is when it actually happened.
    pub fn mark_entered_at(&self, id: &str, now: OffsetDateTime) -> bool {
        let mut records = self.records.lock().unwrap();
        let Some(record) = records.iter_mut().find(|record| record.id == id) else {
            return false;
        };

        if record.entered_at.is_none() {
            record.entered_at = Some(now);
            self.persist(&records);
            drop(records);
            self.changed();
        }
        true
    }

    /// The ids actually removed, which is what the caller logs — asking for one
    /// that has already gone is not an error, it is two looks at the same list.
    ///
    /// The file is written before memory is touched, and a write that fails
    /// takes the whole delete with it. Swallowing it the way `persist` does
    /// would have the window report a record destroyed while the file still
    /// holds it, and the next launch would bring that patient back.
    pub fn delete(&self, ids: &[String]) -> io::Result<Vec<String>> {
        let mut records = self.records.lock().unwrap();
        let (removed, kept): (Vec<Record>, Vec<Record>) = records
            .iter()
            .cloned()
            .partition(|record| ids.contains(&record.id));

        if removed.is_empty() {
            return Ok(Vec::new());
        }

        if let Err(e) = self.write(&kept) {
            error!(error = %e, "delete not written; the records are still held");
            return Err(e);
        }

        *records = kept;
        drop(records);
        self.changed();

        Ok(removed.into_iter().map(|record| record.id).collect())
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
    state.queue().get(&id).map(|record| record.details)
}

#[tauri::command]
pub fn mark_entered(state: State<'_, Arc<AppState>>, id: String) -> bool {
    let marked = state.queue().mark_entered(&id);
    if marked {
        info!("{id} entered");
    }
    marked
}

/// Takes the ids the window offered to delete rather than a rule of its own, so
/// what staff were shown and what is destroyed cannot drift apart between the
/// prompt appearing and the button being pressed.
///
/// An error rejects the call rather than returning a count, so the window can
/// tell staff the records are still here instead of closing on a delete that
/// never reached the disk.
#[tauri::command]
pub fn delete_submissions(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<usize, String> {
    let removed = state.queue().delete(&ids).map_err(|e| e.to_string())?;
    for id in &removed {
        info!("{id} deleted");
    }
    Ok(removed.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use time::Duration;
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
        assert_eq!(listed[0].entered_at, None);
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

    /// The whole point of dropping the sweeper: age alone never removes a
    /// patient, only a staff member does.
    #[test]
    fn age_alone_never_removes_a_record() {
        let queue = Queue::new();
        let submitted = datetime!(2026-08-13 14:12:04 UTC);
        let id = queue.add_at(submission("Jane", "Doe"), None, submitted);

        assert_eq!(queue.list().len(), 1);
        assert!(queue.get(&id).is_some());
    }

    #[test]
    fn marking_entered_keeps_the_record_and_stamps_it() {
        let queue = Queue::new();
        let submitted = datetime!(2026-08-13 14:12:04 UTC);
        let id = queue.add_at(submission("Jane", "Doe"), None, submitted);

        assert!(queue.mark_entered_at(&id, submitted + Duration::minutes(8)));

        let listed = queue.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].entered_at.as_deref(),
            Some("2026-08-13T14:20:04Z")
        );
    }

    #[test]
    fn marking_entered_twice_keeps_the_first_time() {
        let queue = Queue::new();
        let submitted = datetime!(2026-08-13 14:12:04 UTC);
        let id = queue.add_at(submission("Jane", "Doe"), None, submitted);

        queue.mark_entered_at(&id, submitted + Duration::minutes(8));
        assert!(queue.mark_entered_at(&id, submitted + Duration::minutes(30)));

        assert_eq!(
            queue.list()[0].entered_at.as_deref(),
            Some("2026-08-13T14:20:04Z")
        );
    }

    #[test]
    fn marking_entered_reports_a_record_that_has_already_been_deleted() {
        let queue = Queue::new();
        let id = queue.add(submission("Jane", "Doe"), None);
        queue.delete(std::slice::from_ref(&id)).unwrap();

        assert!(!queue.mark_entered(&id));
    }

    #[test]
    fn deleting_is_what_takes_a_record_out() {
        let queue = Queue::new();
        let id = queue.add(submission("Jane", "Doe"), None);

        assert_eq!(
            queue.delete(std::slice::from_ref(&id)).unwrap(),
            vec![id.clone()]
        );
        assert!(queue.get(&id).is_none());
        assert!(queue.list().is_empty());
    }

    #[test]
    fn deleting_reports_only_the_records_that_were_there() {
        let queue = Queue::new();
        let id = queue.add(submission("Jane", "Doe"), None);

        let removed = queue.delete(&[id.clone(), "ffff".to_string()]).unwrap();
        assert_eq!(removed, vec![id]);
        assert!(queue.delete(&["ffff".to_string()]).unwrap().is_empty());
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

        queue.mark_entered_at(&id, submitted + Duration::minutes(8));
        queue.mark_entered_at(&id, submitted + Duration::minutes(9));
        assert_eq!(changes.load(Ordering::Relaxed), 2);

        assert!(!queue.delete(std::slice::from_ref(&id)).unwrap().is_empty());
        assert!(queue.delete(&[id]).unwrap().is_empty());
        assert_eq!(changes.load(Ordering::Relaxed), 3);
    }

    /// The point of writing the file before memory: a record the window said
    /// was destroyed must not be waiting at the next launch.
    #[test]
    fn a_deleted_record_is_gone_after_a_restart() {
        let dir = crate::store::tests::temp_dir();
        let queue = Queue::restored(Store::new(&dir).unwrap()).unwrap();
        let id = queue.add(submission("Jane", "Doe"), None);
        queue.delete(std::slice::from_ref(&id)).unwrap();

        let reopened = Queue::restored(Store::new(&dir).unwrap()).unwrap();
        assert!(reopened.list().is_empty());
    }

    /// A tablet retrying across a restart must not create a second patient.
    #[test]
    fn a_key_survives_a_restart_with_its_record() {
        let dir = crate::store::tests::temp_dir();
        let id = Queue::restored(Store::new(&dir).unwrap())
            .unwrap()
            .add(submission("Jane", "Doe"), Some("abc"));

        let reopened = Queue::restored(Store::new(&dir).unwrap()).unwrap();
        assert_eq!(reopened.add(submission("Jane", "Doe"), Some("abc")), id);
        assert_eq!(reopened.list().len(), 1);
    }
}
