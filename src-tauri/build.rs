fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["get_pairing_info"])),
    )
    .expect("failed to run tauri-build");
}
