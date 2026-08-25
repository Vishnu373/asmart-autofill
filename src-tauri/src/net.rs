use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use netdev::interface::types::InterfaceType;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tracing::info;

use crate::state::AppState;

/// Emitted to the tray whenever the LAN address changes.
pub const ADDRESS_CHANGED: &str = "address-changed";

const POLL_INTERVAL: Duration = Duration::from_secs(10);

/// The parts of a network adapter that address selection cares about.
#[derive(Clone, Debug)]
pub struct Adapter {
    pub wireless: bool,
    pub up: bool,
    pub loopback: bool,
    pub has_gateway: bool,
    pub addrs: Vec<Ipv4Addr>,
}

#[derive(Serialize)]
pub struct PairingInfo {
    pub url: String,
    pub token: String,
    pub port: u16,
}

#[tauri::command]
pub fn get_pairing_info(state: State<'_, Arc<AppState>>) -> Option<PairingInfo> {
    let address = state.address()?;
    let port = state.port()?;
    Some(PairingInfo {
        url: format!("http://{address}:{port}/?t={}", state.token()),
        token: state.token().to_string(),
        port,
    })
}

pub fn detect() -> Option<Ipv4Addr> {
    select(&adapters())
}

/// Re-detect the address on a timer and tell the tray when it changes.
pub fn watch(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            let address = detect();
            if state.set_address(address) {
                info!(?address, "lan address changed");
                let _ = app.emit(ADDRESS_CHANGED, ());
            }
        }
    });
}

/// Highest-scoring usable adapter wins; ties go to the first listed.
pub fn select(adapters: &[Adapter]) -> Option<Ipv4Addr> {
    adapters
        .iter()
        .filter_map(|adapter| {
            let addr = usable_addr(adapter)?;
            Some((score(adapter), addr))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, addr)| addr)
}

fn usable_addr(adapter: &Adapter) -> Option<Ipv4Addr> {
    if adapter.loopback || !adapter.up {
        return None;
    }
    adapter.addrs.iter().copied().find(usable)
}

fn usable(addr: &Ipv4Addr) -> bool {
    !addr.is_loopback() && !addr.is_unspecified() && !addr.is_link_local() && !addr.is_broadcast()
}

fn score(adapter: &Adapter) -> u8 {
    match (adapter.wireless, adapter.has_gateway) {
        (true, true) => 4,
        (true, false) => 3,
        (false, true) => 2,
        (false, false) => 1,
    }
}

fn adapters() -> Vec<Adapter> {
    netdev::get_interfaces()
        .into_iter()
        .map(|interface| Adapter {
            wireless: interface.if_type == InterfaceType::Wireless80211,
            up: interface.is_up() && interface.is_running(),
            loopback: interface.is_loopback(),
            has_gateway: interface.gateway.is_some(),
            addrs: interface.ipv4_addrs(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(wireless: bool, has_gateway: bool, addr: &str) -> Adapter {
        Adapter {
            wireless,
            up: true,
            loopback: false,
            has_gateway,
            addrs: vec![addr.parse().unwrap()],
        }
    }

    #[test]
    fn prefers_wifi_over_ethernet() {
        let list = vec![
            adapter(false, true, "10.0.0.5"),
            adapter(true, true, "192.168.1.20"),
        ];
        assert_eq!(select(&list), Some(Ipv4Addr::new(192, 168, 1, 20)));
    }

    #[test]
    fn prefers_a_gatewayed_wifi_adapter_over_one_without() {
        let list = vec![
            adapter(true, false, "192.168.5.9"),
            adapter(true, true, "192.168.1.20"),
        ];
        assert_eq!(select(&list), Some(Ipv4Addr::new(192, 168, 1, 20)));
    }

    #[test]
    fn falls_back_to_ethernet_when_there_is_no_wifi() {
        let list = vec![adapter(false, true, "10.0.0.5")];
        assert_eq!(select(&list), Some(Ipv4Addr::new(10, 0, 0, 5)));
    }

    #[test]
    fn skips_loopback_down_and_unusable_adapters() {
        let mut loopback = adapter(false, false, "127.0.0.1");
        loopback.loopback = true;
        let mut down = adapter(true, true, "192.168.1.20");
        down.up = false;
        let link_local = adapter(false, false, "169.254.3.4");

        let list = vec![loopback, down, link_local, adapter(false, true, "10.0.0.5")];
        assert_eq!(select(&list), Some(Ipv4Addr::new(10, 0, 0, 5)));
    }

    #[test]
    fn returns_nothing_when_no_adapter_is_usable() {
        let mut down = adapter(true, true, "192.168.1.20");
        down.up = false;
        assert_eq!(select(&[down]), None);
    }

    #[test]
    fn ignores_unusable_addresses_on_an_otherwise_good_adapter() {
        let mut wifi = adapter(true, true, "169.254.1.1");
        wifi.addrs.push(Ipv4Addr::new(192, 168, 1, 20));
        assert_eq!(select(&[wifi]), Some(Ipv4Addr::new(192, 168, 1, 20)));
    }
}
