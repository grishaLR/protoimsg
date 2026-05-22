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
