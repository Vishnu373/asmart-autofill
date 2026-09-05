fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_pairing_info",
            "list_waiting",
            "get_submission",
            "mark_entered",
            "delete_submissions",
        ]),
    ))
    .expect("failed to run tauri-build");
}
