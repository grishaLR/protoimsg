/** Backend API base URL. Empty in dev (Vite proxy), full URL in production. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** True when running inside a Tauri v2 desktop shell. */
// __TAURI_INTERNALS__ is injected before page scripts run (unlike __TAURI__ which
// may not be available during top-level execution — see tauri-apps/tauri#12990).
export const IS_TAURI: boolean = '__TAURI_INTERNALS__' in window;
