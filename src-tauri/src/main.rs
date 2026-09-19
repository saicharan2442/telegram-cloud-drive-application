// Telegram Cloud Drive — Tauri 2 shell.
//
// MTProto runs inside the WebView over a WebSocket straight to Telegram's data
// centres, so this shell stays intentionally tiny: no database, no local
// server, no background work, no IPC chatter. See DOCS.md for the (optional)
// upgrade that moves the session key into the Windows Credential Manager.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Telegram Cloud Drive");
}
