use std::fs;
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::queue::Record;

const FILE: &str = "queue.dat";

/// The record file, and the only place a submission is written down. Everything
/// leaving memory goes through `seal`, so the fields exist in the clear inside
/// this process and nowhere else.
pub struct Store {
    path: PathBuf,
}

impl Store {
    /// `dir` is the app's local data directory — `%LOCALAPPDATA%\com.asmart.autofill`.
    /// Local, not roaming: Windows does not sync it to OneDrive or to another
    /// machine the staff account signs into.
    pub fn new(dir: &Path) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        Ok(Self {
            path: dir.join(FILE),
        })
    }

    /// No file means a first run, not a failure. Anything else is reported:
    /// a file we could not read this once still holds real patients, and
    /// starting empty would have the next write replace them.
    pub fn load(&self) -> io::Result<Vec<Record>> {
        let sealed = match fs::read(&self.path) {
            Ok(sealed) => sealed,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(self.unreadable(e)),
        };

        let plain = crypt::unseal(&sealed).map_err(|e| self.unreadable(e))?;
        serde_json::from_slice(&plain).map_err(|e| self.unreadable(io::Error::other(e)))
    }

    /// Refusing to start is the deliberate answer, but it is a dead end unless
    /// the message says which file and what to do about it. DPAPI stops
    /// decrypting for good once an administrator resets the account password or
    /// rebuilds the profile, and from then on every launch fails the same way.
    fn unreadable(&self, cause: io::Error) -> io::Error {
        io::Error::new(
            cause.kind(),
            format!(
                "the record file could not be read: {cause}\n\n\
                 File: {}\n\n\
                 Records are tied to this Windows account on this computer, so a \
                 reset password or a rebuilt profile leaves an older file \
                 unreadable. Move that file somewhere else and the application \
                 will start again — the patients still in it cannot be recovered.",
                self.path.display()
            ),
        )
    }

    /// Written beside the real file and renamed over it. A crash partway
    /// through a direct write leaves bytes that decrypt to nothing, which
    /// loses every record rather than the one being added.
    ///
    /// The rename swaps the names atomically; it does not push the bytes out of
    /// the cache. Without the flush a power cut can leave the new name pointing
    /// at a short file, which then fails to decrypt and stops the application
    /// starting at all — the exact loss the temporary file is here to prevent.
    pub fn save(&self, records: &[Record]) -> io::Result<()> {
        let plain = serde_json::to_vec(records).map_err(io::Error::other)?;
        let sealed = crypt::seal(&plain)?;

        let temp = self.path.with_extension("tmp");
        let mut file = fs::File::create(&temp)?;
        file.write_all(&sealed)?;
        file.sync_all()?;
        drop(file);

        fs::rename(&temp, &self.path)
    }
}

/// DPAPI ties the file to this Windows account on this machine: copied to
/// another computer it will not decrypt, and there is no key to store beside
/// the data it is meant to protect.
#[cfg(windows)]
mod crypt {
    use std::ffi::c_void;
    use std::io;
    use std::ptr;

    #[repr(C)]
    struct Blob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            data_in: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut Blob,
        ) -> i32;

        fn CryptUnprotectData(
            data_in: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut Blob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    /// Mixed into the key, so another program running as the same user cannot
    /// hand this file to DPAPI and read the fields back out of it.
    const ENTROPY: &[u8] = b"com.asmart.autofill/queue";

    /// A write can happen with no desktop attached, and DPAPI must never stop
    /// to ask for one.
    const UI_FORBIDDEN: u32 = 0x1;

    pub fn seal(plain: &[u8]) -> io::Result<Vec<u8>> {
        call(plain, true)
    }

    pub fn unseal(sealed: &[u8]) -> io::Result<Vec<u8>> {
        call(sealed, false)
    }

    /// DPAPI reads the input and never writes to it; the struct simply has no
    /// const form, which is why the pointer is cast here.
    fn blob(bytes: &[u8]) -> Blob {
        Blob {
            cb_data: bytes.len() as u32,
            pb_data: bytes.as_ptr().cast_mut(),
        }
    }

    fn call(input: &[u8], protect: bool) -> io::Result<Vec<u8>> {
        let source = blob(input);
        let entropy = blob(ENTROPY);
        let mut out = Blob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        // SAFETY: both inputs outlive the call, and `out` is the caller-owned
        // struct the API fills in.
        let ok = unsafe {
            if protect {
                CryptProtectData(
                    &source,
                    ptr::null(),
                    &entropy,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    UI_FORBIDDEN,
                    &mut out,
                )
            } else {
                CryptUnprotectData(
                    &source,
                    ptr::null_mut(),
                    &entropy,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    UI_FORBIDDEN,
                    &mut out,
                )
            }
        };

        if ok == 0 {
            return Err(io::Error::last_os_error());
        }

        // SAFETY: success means `out` points at `cb_data` bytes DPAPI allocated
        // with LocalAlloc, which this call now owns and must free.
        let copied =
            unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        unsafe { LocalFree(out.pb_data.cast()) };

        Ok(copied)
    }
}

/// Development only. Windows is the only target this ships to, and there the
/// module above is what runs. A Linux build exists so the tests and clippy can
/// be run from WSL, and it leaves the records in the clear — never install from
/// a non-Windows build.
#[cfg(not(windows))]
mod crypt {
    use std::io;

    pub fn seal(plain: &[u8]) -> io::Result<Vec<u8>> {
        Ok(plain.to_vec())
    }

    pub fn unseal(sealed: &[u8]) -> io::Result<Vec<u8>> {
        Ok(sealed.to_vec())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU32, Ordering};

    use time::macros::datetime;

    use crate::queue::Queue;
    use crate::submission::Submission;

    /// A directory of this test's own, since the store is one fixed filename.
    /// Handed out as a path so a test can reopen the same store twice and see
    /// what a restart would see.
    pub fn temp_dir() -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "asmart-store-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn temp_store() -> Store {
        Store::new(&temp_dir()).unwrap()
    }

    fn submission() -> Submission {
        Submission {
            first_name: "Jane".to_string(),
            last_name: "Doe".to_string(),
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
    fn a_store_with_no_file_yet_is_empty() {
        assert!(temp_store().load().unwrap().is_empty());
    }

    #[test]
    fn records_come_back_as_they_went_in() {
        let store = temp_store();
        let record = Record {
            id: "a3f9".to_string(),
            details: submission(),
            submitted_at: datetime!(2026-08-13 14:12:04 UTC),
            entered_at: Some(datetime!(2026-08-13 14:20:00 UTC)),
            idempotency_key: Some("abc".to_string()),
        };

        store.save(std::slice::from_ref(&record)).unwrap();
        let loaded = store.load().unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, record.id);
        assert_eq!(loaded[0].details.health_insurance_number, "DOEJ 9001 0112");
        assert_eq!(loaded[0].submitted_at, record.submitted_at);
        assert_eq!(loaded[0].entered_at, record.entered_at);
        assert_eq!(loaded[0].idempotency_key, record.idempotency_key);
    }

    /// The whole point of the file being sealed. Only meaningful where DPAPI is
    /// real — the fallback above deliberately writes plaintext.
    #[cfg(windows)]
    #[test]
    fn nothing_readable_reaches_the_disk() {
        let store = temp_store();
        store
            .save(&[Record {
                id: "a3f9".to_string(),
                details: submission(),
                submitted_at: datetime!(2026-08-13 14:12:04 UTC),
                entered_at: None,
                idempotency_key: None,
            }])
            .unwrap();

        let raw = fs::read(&store.path).unwrap();
        for secret in [b"DOEJ 9001 0112".as_slice(), b"Jane".as_slice()] {
            assert!(
                !raw.windows(secret.len()).any(|window| window == secret),
                "the record file holds {} in the clear",
                String::from_utf8_lossy(secret)
            );
        }
    }

    /// Whatever went wrong, the operator is left holding a file they cannot
    /// read and an application that will not start. The message has to name it.
    #[test]
    fn an_unreadable_file_names_itself_and_the_way_out() {
        let store = temp_store();
        store.save(&[]).unwrap();
        fs::write(&store.path, b"not a sealed record file").unwrap();

        let reported = store.load().unwrap_err().to_string();
        assert!(reported.contains("queue.dat"), "{reported}");
        assert!(reported.contains("Move that file"), "{reported}");
    }

    #[test]
    fn a_restart_finds_what_the_last_run_left() {
        let dir = temp_dir();
        let id = Queue::restored(Store::new(&dir).unwrap())
            .unwrap()
            .add(submission(), None);

        let reopened = Queue::restored(Store::new(&dir).unwrap()).unwrap();
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.get(&id).unwrap().details.first_name, "Jane");
    }
}
