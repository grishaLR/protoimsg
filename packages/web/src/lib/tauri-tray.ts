/**
 * Tauri tray helpers — updates the system tray tooltip with buddy count and status.
 * Dynamically imported only when IS_TAURI is true.
 */

import { invoke } from '@tauri-apps/api/core';

export async function updateTrayTooltip(onlineCount: number, status: string): Promise<void> {
  const tooltip = `Chatmosphere — ${String(onlineCount)} buddies online (${status})`;
  await invoke('update_tray_tooltip', { tooltip });
}
