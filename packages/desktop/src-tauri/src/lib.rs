use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

/// Build the tray menu. In a call, "Start Meet" / "Open proto town" are replaced
/// by a disabled "◉ In a call" indicator. The town item only shows when the
/// frontend reports town is enabled in this build.
fn build_tray_menu<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    in_call: bool,
    town: bool,
) -> tauri::Result<Menu<R>> {
    let show_item = MenuItemBuilder::with_id("show", "Show protoimsg").build(manager)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(manager)?;
    let mut builder = MenuBuilder::new(manager);
    if in_call {
        let call_item = MenuItemBuilder::with_id("call_active", "◉ In a call")
            .enabled(false)
            .build(manager)?;
        builder = builder.item(&call_item).separator().item(&show_item);
    } else {
        let meet_item = MenuItemBuilder::with_id("meet", "Start Meet").build(manager)?;
        builder = builder.item(&show_item).item(&meet_item);
        if town {
            let town_item = MenuItemBuilder::with_id("town", "Open proto town").build(manager)?;
            builder = builder.item(&town_item);
        }
    }
    builder.separator().item(&quit_item).build()
}

/// Rebuild the tray menu to reflect active call state and town availability.
#[tauri::command]
fn set_call_state(app: tauri::AppHandle, active: bool, town: bool) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let result = build_tray_menu(&app, active, town).and_then(|menu| tray.set_menu(Some(menu)));
    if let Err(e) = result {
        eprintln!("set_call_state: failed to rebuild tray menu: {e}");
    }
}

/// Show + focus the main window, then emit an event for the frontend to handle.
fn show_main_and_emit(app: &tauri::AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(event, ());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            update_tray_tooltip,
            set_call_state
        ])
        .setup(|app| {
            // Initial tray menu — the frontend rebuilds it (with the town item
            // when enabled) via set_call_state once it mounts.
            let menu = build_tray_menu(app, false, false)?;

            // Build tray icon
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("app icon must be set in tauri.conf.json");

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("protoimsg")
                .menu(&menu)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    // Frontend handles window creation / town entry.
                    "meet" => show_main_and_emit(app, "app://open-meet"),
                    "town" => show_main_and_emit(app, "app://open-town"),
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Main window close → hide to tray instead of quitting
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // Notify the frontend so it can clean up active calls (beforeunload
                    // doesn't fire when hiding to tray).
                    let _ = window.emit("app://window-hiding", ());
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
