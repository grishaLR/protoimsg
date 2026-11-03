/**
 * Tauri v2 multi-window helpers.
 * Dynamically imported only when IS_TAURI is true — web builds never bundle this.
 */

import { LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/** Main window size while in proto town — wide enough for town + buddy sidebar. */
const TOWN_WINDOW_SIZE = { width: 1100, height: 720 };

/** Main window bounds before entering town; null when not expanded. */
let boundsBeforeTown: { size: PhysicalSize; position: PhysicalPosition } | null = null;

/** Expand/restore run one at a time so a grow and a shrink can't interleave. */
let resizeChain: Promise<void> = Promise.resolve();

function enqueueResize(step: () => Promise<void>): Promise<void> {
  resizeChain = resizeChain.then(step).catch((err: unknown) => {
    console.error('main window town resize failed:', err);
  });
  return resizeChain;
}

/**
 * Grow the main (buddy list) window so proto town fits beside the buddy list.
 * Town stays in the main window on purpose: it shares the real WebSocket and
 * the presence state (town visibility cap, away status) with the buddy list.
 */
export function expandMainWindowForTown(): Promise<void> {
  return enqueueResize(async () => {
    if (boundsBeforeTown) return;
    const win = getCurrentWebviewWindow();
    const [size, position, factor] = await Promise.all([
      win.innerSize(),
      win.outerPosition(),
      win.scaleFactor(),
    ]);
    boundsBeforeTown = { size, position };
    const prev = size.toLogical(factor);
    await win.setSize(
      new LogicalSize(
        Math.max(prev.width, TOWN_WINDOW_SIZE.width),
        Math.max(prev.height, TOWN_WINDOW_SIZE.height),
      ),
    );
    await win.center();
  });
}

/** Put the main window back where and how big it was before town. No-op if not expanded. */
export function restoreMainWindowFromTown(): Promise<void> {
  return enqueueResize(async () => {
    const prev = boundsBeforeTown;
    if (!prev) return;
    boundsBeforeTown = null;
    const win = getCurrentWebviewWindow();
    await win.setSize(prev.size);
    await win.setPosition(prev.position);
  });
}

/** Main window size while on the PDS sign-in page (a full-page OAuth redirect). */
const OAUTH_WINDOW_SIZE = { width: 480, height: 760 };

/**
 * Pre-OAuth window bounds. sessionStorage, not module state: the page navigates
 * to the PDS and back, which wipes module state but keeps sessionStorage.
 */
const OAUTH_BOUNDS_KEY = 'protoimsg:oauth_window_bounds';

interface StoredBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Widen the main window so the PDS sign-in page isn't squeezed. Call right before redirecting. */
export function expandMainWindowForOAuth(): Promise<void> {
  return enqueueResize(async () => {
    if (sessionStorage.getItem(OAUTH_BOUNDS_KEY)) return;
    const win = getCurrentWebviewWindow();
    const [size, position, factor] = await Promise.all([
      win.innerSize(),
      win.outerPosition(),
      win.scaleFactor(),
    ]);
    const bounds: StoredBounds = {
      width: size.width,
      height: size.height,
      x: position.x,
      y: position.y,
    };
    sessionStorage.setItem(OAUTH_BOUNDS_KEY, JSON.stringify(bounds));
    const prev = size.toLogical(factor);
    await win.setSize(
      new LogicalSize(
        Math.max(prev.width, OAUTH_WINDOW_SIZE.width),
        Math.max(prev.height, OAUTH_WINDOW_SIZE.height),
      ),
    );
    await win.center();
  });
}

/** Back to the pre-OAuth size and position. No-op if the window wasn't expanded. */
export function restoreMainWindowAfterOAuth(): Promise<void> {
  return enqueueResize(async () => {
    const raw = sessionStorage.getItem(OAUTH_BOUNDS_KEY);
    if (!raw) return;
    sessionStorage.removeItem(OAUTH_BOUNDS_KEY);
    const b = JSON.parse(raw) as StoredBounds;
    const win = getCurrentWebviewWindow();
    await win.setSize(new PhysicalSize(b.width, b.height));
    await win.setPosition(new PhysicalPosition(b.x, b.y));
  });
}

/** Check if this is the main (buddy list) window */
export function isMainWindow(): boolean {
  return getCurrentWebviewWindow().label === 'main';
}

/** Get window label for current webview */
export function getWindowLabel(): string {
  return getCurrentWebviewWindow().label;
}

/** Close the current window (for child windows — use window controls) */
export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWebviewWindow().close();
}

/** Minimize the current window */
export async function minimizeCurrentWindow(): Promise<void> {
  await getCurrentWebviewWindow().minimize();
}

/** Open or focus a DM window */
export async function openDmWindow(conversationId: string, recipientDid: string): Promise<void> {
  const label = `dm-${conversationId}`;
  await openOrFocusWindow({
    label,
    url: `/dm/${conversationId}?recipientDid=${encodeURIComponent(recipientDid)}`,
    title: `${recipientDid} — DM`,
    width: 380,
    height: 480,
    minWidth: 280,
    minHeight: 320,
  });
}

/** Open or focus a video call window (always on top) */
export async function openVideoCallWindow(
  conversationId: string,
  recipientDid: string,
): Promise<void> {
  const label = `videocall-${conversationId}`;
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const webview = new WebviewWindow(label, {
      url: `/videocall/${conversationId}?recipientDid=${encodeURIComponent(recipientDid)}`,
      title: `Video Call — protoimsg`,
      width: 640,
      height: 520,
      minWidth: 480,
      minHeight: 400,
      center: true,
      resizable: true,
      decorations: false,
      alwaysOnTop: true,
    });

    void webview.once('tauri://error', (e) => {
      console.error(`Failed to create video call window "${label}":`, e);
    });
  } catch (err) {
    console.error(`openVideoCallWindow("${label}") failed:`, err);
  }
}

/** Close the video call window for a conversation */
export async function closeVideoCallWindow(conversationId: string): Promise<void> {
  try {
    const existing = await WebviewWindow.getByLabel(`videocall-${conversationId}`);
    if (existing) {
      await existing.close();
    }
  } catch {
    // Window may already be closed
  }
}

/** Open or focus a profile window for a given DID */
export async function openProfileWindow(did: string): Promise<void> {
  const label = `profile-${did.replace(/[^a-zA-Z0-9]/g, '-')}`;
  await openOrFocusWindow({
    label,
    url: `/profile/${encodeURIComponent(did)}`,
    title: 'Profile — protoimsg',
    width: 420,
    height: 600,
    minWidth: 320,
    minHeight: 480,
  });
}

/** Open or focus a group meet window */
export async function openMeetWindow(meetCode?: string): Promise<void> {
  const label = 'meet';
  const url = meetCode ? `/meet-window/${meetCode}` : '/meet-window';
  await openOrFocusWindow({
    label,
    url,
    title: 'Meet — protoimsg',
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
  });
}

/** Open or focus the games window */
export async function openGamesWindow(): Promise<void> {
  await openOrFocusWindow({
    label: 'games',
    url: '/games',
    title: 'Games — protoimsg',
    width: 480,
    height: 640,
    minWidth: 380,
    minHeight: 520,
  });
}

/** Open or focus the protobuddy bot window */
export async function openBotWindow(): Promise<void> {
  await openOrFocusWindow({
    label: 'bot',
    url: '/bot',
    title: 'protobuddy — protoimsg',
    width: 360,
    height: 520,
    minWidth: 280,
    minHeight: 400,
  });
}

interface WindowConfig {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

async function openOrFocusWindow(config: WindowConfig): Promise<void> {
  try {
    const existing = await WebviewWindow.getByLabel(config.label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const webview = new WebviewWindow(config.label, {
      url: config.url,
      title: config.title,
      width: config.width,
      height: config.height,
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      center: true,
      resizable: true,
      decorations: false,
    });

    void webview.once('tauri://error', (e) => {
      console.error(`Failed to create window "${config.label}":`, e);
    });
  } catch (err) {
    console.error(`openOrFocusWindow("${config.label}") failed:`, err);
  }
}
