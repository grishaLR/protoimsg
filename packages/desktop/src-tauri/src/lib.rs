use std::{collections::HashMap, sync::Mutex};

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    plugin::{Builder as PluginBuilder, TauriPlugin},
    tray::TrayIconBuilder,
    utils::config::FrontendDist,
    webview::{PageLoadEvent, PermissionKind, PermissionResponse},
    AppHandle, Emitter, Manager, Runtime, Url, WindowEvent,
};

/// Each webview's committed page — the document actually running in it. Not
/// `Webview::url()`: WebKit reports the *provisional* URL as soon as a
/// navigation starts, so a foreign page could begin navigating to our site
/// and ask for the camera before the navigation commits.
#[derive(Default)]
struct CommittedPages(Mutex<HashMap<String, Url>>);

/// The site this app loads: `devUrl` under `tauri dev`, `frontendDist` in builds.
fn app_url<R: Runtime>(app: &AppHandle<R>) -> Option<Url> {
    let build = &app.config().build;
    if tauri::is_dev() {
        build.dev_url.clone()
    } else {
        match &build.frontend_dist {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    }
}

fn is_app_url<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    app_url(app).is_some_and(|home| home.origin() == url.origin())
}

/// Camera and microphone for our own site only. Without a handler, WebKit on
/// macOS grants media capture to *any* page — and the main window passes
/// through third-party PDS sign-in pages, from which a user can click anywhere.
fn permission_for<R: Runtime>(
    webview: tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    let app = webview.app_handle();
    let on_app = app.try_state::<CommittedPages>().is_some_and(|pages| {
        pages
            .0
            .lock()
            .ok()
            .and_then(|map| map.get(webview.label()).cloned())
            .is_some_and(|url| is_app_url(app, &url))
    });
    match (on_app, kind) {
        (false, _) => PermissionResponse::Deny,
        // Same as before: no extra in-app prompt (the OS still asks once).
        (true, PermissionKind::Camera | PermissionKind::Microphone) => PermissionResponse::Allow,
        (true, _) => PermissionResponse::Default,
    }
}

/// The one third-party frame the site embeds (its CSP `frame-src`): the
/// Turnstile captcha, used in the main window and the games window.
const CAPTCHA_HOST: &str = "challenges.cloudflare.com";

/// Windows that may leave our site for https pages: both can start an OAuth
/// sign-in, which redirects to the user's PDS and back.
const SIGN_IN_WINDOWS: [&str; 2] = ["main", "games"];

/// Keeps every window on our site, except sign-in windows on https (the PDS
/// redirect); "Show" brings the main window home. Runs for every webview,
/// including windows the page opens itself, and for iframes too (WebKit asks
/// for subframe navigations as well). Also records each webview's committed
/// page for `permission_for`.
fn web_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("web-guard")
        .setup(|app, _api| {
            app.manage(CommittedPages::default());
            Ok(())
        })
        .on_navigation(|webview, url| {
            is_app_url(webview.app_handle(), url)
                || url.as_str() == "about:blank"
                || (url.scheme() == "https" && url.host_str() == Some(CAPTCHA_HOST))
                || (SIGN_IN_WINDOWS.contains(&webview.label()) && url.scheme() == "https")
        })
        // `Started` fires once the new document has committed (macOS
        // didCommitNavigation, Linux Committed, Windows ContentLoading).
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Started {
                return;
            }
            if let Some(pages) = webview.app_handle().try_state::<CommittedPages>() {
                if let Ok(mut map) = pages.0.lock() {
                    map.insert(webview.label().to_string(), payload.url().clone());
                }
            }
        })
        .build()
}

/// Show + focus the main window. If it was hidden while on another site (a
/// sign-in page, or a link followed from one), bring it back to ours first —
/// the frameless window has no back button. Returns whether it reloaded.
fn show_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let hidden = !window.is_visible().unwrap_or(true);
    let off_site = window.url().is_ok_and(|url| !is_app_url(app, &url));
    let mut reloaded = false;
    if hidden && off_site {
        if let Some(home) = app_url(app) {
            reloaded = window.navigate(home).is_ok();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    reloaded
}

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
///
/// The app loads the hosted site, so the web side can be newer or older than
/// this binary: commands must stay backward compatible. `town` is optional
/// (older web builds don't send it).
#[tauri::command]
fn set_call_state(app: tauri::AppHandle, active: bool, town: Option<bool>) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let result = build_tray_menu(&app, active, town.unwrap_or(false))
        .and_then(|menu| tray.set_menu(Some(menu)));
    if let Err(e) = result {
        eprintln!("set_call_state: failed to rebuild tray menu: {e}");
    }
}

/// Show + focus the main window, then emit an event for the frontend to handle.
fn show_main_and_emit(app: &AppHandle, event: &str) {
    // Reloading home: the page isn't listening yet, so the event would be
    // lost — showing the app is the useful part then.
    if show_main(app) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, ());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(web_guard())
        .on_permission_request(permission_for)
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
                        show_main(app);
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
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Labels get reused (videocall-…, dm-…): forget a closed window's page.
            if let WindowEvent::Destroyed = event {
                if let Some(pages) = window.app_handle().try_state::<CommittedPages>() {
                    if let Ok(mut map) = pages.0.lock() {
                        map.remove(window.label());
                    }
                }
            }
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
