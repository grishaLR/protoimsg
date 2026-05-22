use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

/// Rebuild the tray menu to reflect active call state.
/// When active, replaces "Start Meet" with a disabled "◉ In a call" indicator.
#[tauri::command]
fn set_call_state(app: tauri::AppHandle, active: bool) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let result = (|| -> tauri::Result<()> {
        let menu = if active {
            let call_item = MenuItemBuilder::with_id("call_active", "◉ In a call")
                .enabled(false)
                .build(&app)?;
            let show_item = MenuItemBuilder::with_id("show", "Show protoimsg").build(&app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(&app)?;
            MenuBuilder::new(&app)
                .item(&call_item)
                .separator()
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?
        } else {
            let show_item = MenuItemBuilder::with_id("show", "Show protoimsg").build(&app)?;
            let meet_item = MenuItemBuilder::with_id("meet", "Start Meet").build(&app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(&app)?;
            MenuBuilder::new(&app)
                .item(&show_item)
                .item(&meet_item)
                .separator()
                .item(&quit_item)
                .build()?
        };
        tray.set_menu(Some(menu))?;
        Ok(())
    })();
    if let Err(e) = result {
        eprintln!("set_call_state: failed to rebuild tray menu: {e}");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![update_tray_tooltip, set_call_state])
        .setup(|app| {
            // Build tray menu
            let show_item = MenuItemBuilder::with_id("show", "Show protoimsg").build(app)?;
            let meet_item = MenuItemBuilder::with_id("meet", "Start Meet").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&meet_item)
                .separator()
                .item(&quit_item)
                .build()?;

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
                    "meet" => {
                        // Emit to frontend — it handles window creation via tauri-windows.ts
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("app://open-meet", ());
                        }
                    }
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
