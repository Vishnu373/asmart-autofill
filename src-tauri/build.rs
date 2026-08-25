fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(
                tauri_build::AppManifest::new()
                    .commands(&["get_pairing_info", "get_waiting_count"]),
            ),
    )
    .expect("failed to run tauri-build");
}
