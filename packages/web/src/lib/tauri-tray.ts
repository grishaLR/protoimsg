/**
 * Tauri tray helpers — updates the system tray tooltip with buddy count and status.
 * Dynamically imported only when IS_TAURI is true.
 */

import { invoke } from '@tauri-apps/api/core';

export async function updateTrayTooltip(
  onlineCount: number,
  status: string,
  unreadCount?: number,
  inCall?: boolean,
): Promise<void> {
  const parts = [`proto instant messenger — ${String(onlineCount)} buddies online (${status})`];

  if (inCall) {
    parts.push('In a call');
  }
  if (unreadCount && unreadCount > 0) {
    parts.push(`${String(unreadCount)} unread mention${unreadCount === 1 ? '' : 's'}`);
  }

  await invoke('update_tray_tooltip', { tooltip: parts.join(' · ') });
}

/** Rebuild the tray menu to show/hide the active-call indicator. */
export async function setTrayCallState(active: boolean): Promise<void> {
  await invoke('set_call_state', { active });
}
