/**
 * Tauri v2 multi-window helpers.
 * Dynamically imported only when IS_TAURI is true — web builds never bundle this.
 */

import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

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

/** Open or focus a room window */
export async function openRoomWindow(roomId: string, roomName: string): Promise<void> {
  const label = `room-${roomId}`;
  await openOrFocusWindow({
    label,
    url: `/rooms/${roomId}`,
    title: `#${roomName} — Chatmosphere`,
    width: 520,
    height: 620,
    minWidth: 360,
    minHeight: 400,
  });
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

/** Open or focus the room directory window */
export async function openRoomDirectoryWindow(): Promise<void> {
  await openOrFocusWindow({
    label: 'rooms-directory',
    url: '/rooms-directory',
    title: 'Chat Rooms — Chatmosphere',
    width: 520,
    height: 620,
    minWidth: 360,
    minHeight: 400,
  });
}

/** Open or focus the feed window */
export async function openFeedWindow(): Promise<void> {
  await openOrFocusWindow({
    label: 'feed',
    url: '/feed',
    title: 'Feed — Chatmosphere',
    width: 560,
    height: 700,
    minWidth: 400,
    minHeight: 500,
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
