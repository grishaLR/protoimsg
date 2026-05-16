/** Backend API base URL. Empty in dev (Vite proxy), full URL in production. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** PDS base URL for account creation. */
export const PDS_URL: string =
  (import.meta.env.VITE_PDS_URL as string | undefined) ?? 'https://pds.protoimsg.app';

/** Feature flag: set VITE_SIGNUP_ENABLED=false to hide full account creation signup. */
export const SIGNUP_ENABLED: boolean = import.meta.env.VITE_SIGNUP_ENABLED !== 'false';

/** Feature flag: set VITE_BOT_ENABLED=true to enable ProtoBuddy bot. */
export const BOT_ENABLED: boolean = import.meta.env.VITE_BOT_ENABLED === 'true';

/** Feature flag: set VITE_RUNNER_ENABLED=true to show the Runner game (WIP). */
export const RUNNER_ENABLED: boolean = import.meta.env.VITE_RUNNER_ENABLED === 'true';

/** Feature flag: set VITE_FEED_ENABLED=true to show the Feed tab. Hidden by default. */
export const FEED_ENABLED: boolean = import.meta.env.VITE_FEED_ENABLED === 'true';

/** Feature flag: set VITE_CHAT_ROOMS_ENABLED=true to show Chat Rooms. Hidden by default. */
export const CHAT_ROOMS_ENABLED: boolean = import.meta.env.VITE_CHAT_ROOMS_ENABLED === 'true';

/** Cloudflare Turnstile site key for signup CAPTCHA (optional — skipped when absent). */
export const TURNSTILE_SITE_KEY: string | undefined =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

/** Game master DID — owner of equipment.rpg.give records we scan for pending gifts. */
export const GAME_MASTER_DID: string =
  (import.meta.env.VITE_GAME_MASTER_DID as string | undefined) ??
  'did:plc:ew5e3up4h2jf4j263qhdjo4e';

/** Base URL for the RPG actor registry API. */
export const RPG_ACTOR_API_URL: string =
  (import.meta.env.VITE_RPG_ACTOR_API_URL as string | undefined) ?? 'https://rpg.actor';

/** True when running inside a Tauri v2 desktop shell. */
// __TAURI_INTERNALS__ is injected before page scripts run (unlike __TAURI__ which
// may not be available during top-level execution — see tauri-apps/tauri#12990).
export const IS_TAURI: boolean = '__TAURI_INTERNALS__' in window;
