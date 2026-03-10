/** Backend API base URL. Empty in dev (Vite proxy), full URL in production. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** PDS base URL for account creation. */
export const PDS_URL: string =
  (import.meta.env.VITE_PDS_URL as string | undefined) ?? 'https://pds.protoimsg.app';

/** Feature flag: set VITE_SIGNUP_ENABLED=false to hide full account creation signup. */
export const SIGNUP_ENABLED: boolean = import.meta.env.VITE_SIGNUP_ENABLED !== 'false';

/** Feature flag: set VITE_BOT_ENABLED=true to enable ProtoBuddy bot. */
export const BOT_ENABLED: boolean = import.meta.env.VITE_BOT_ENABLED === 'true';

/** Cloudflare Turnstile site key for signup CAPTCHA (optional — skipped when absent). */
export const TURNSTILE_SITE_KEY: string | undefined =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

/** True when running inside a Tauri v2 desktop shell. */
// __TAURI_INTERNALS__ is injected before page scripts run (unlike __TAURI__ which
// may not be available during top-level execution — see tauri-apps/tauri#12990).
export const IS_TAURI: boolean = '__TAURI_INTERNALS__' in window;
