use std::io;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, Ordering};

use tokio::sync::oneshot;

use crate::queue::Queue;
use crate::store::Store;

pub struct AppState {
    port: AtomicU16,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    token: String,
    address: Mutex<Option<Ipv4Addr>>,
    queue: Arc<Queue>,
}

impl AppState {
    /// In-memory only, so the router tests need no disk. The application
    /// always goes through `restored`.
    #[cfg(test)]
    pub fn new(token: String) -> Arc<Self> {
        Self::build(token, Queue::new())
    }

    /// The startup path: the queue is whatever the last run left on disk.
    pub fn restored(token: String, store: Store) -> io::Result<Arc<Self>> {
        Ok(Self::build(token, Queue::restored(store)?))
    }

    fn build(token: String, queue: Queue) -> Arc<Self> {
        Arc::new(Self {
            port: AtomicU16::new(0),
            shutdown: Mutex::new(None),
            token,
            address: Mutex::new(None),
            queue: Arc::new(queue),
        })
    }

    pub fn queue(&self) -> &Arc<Queue> {
        &self.queue
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn address(&self) -> Option<Ipv4Addr> {
        *self.address.lock().unwrap()
    }

    /// Returns true when the address actually changed.
    pub fn set_address(&self, address: Option<Ipv4Addr>) -> bool {
        let mut current = self.address.lock().unwrap();
        if *current == address {
            return false;
        }
        *current = address;
        true
    }

    pub fn port(&self) -> Option<u16> {
        match self.port.load(Ordering::Relaxed) {
            0 => None,
            port => Some(port),
        }
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::Relaxed);
    }

    pub fn set_shutdown(&self, tx: oneshot::Sender<()>) {
        *self.shutdown.lock().unwrap() = Some(tx);
    }

    pub fn shutdown(&self) {
        if let Some(tx) = self.shutdown.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
}
