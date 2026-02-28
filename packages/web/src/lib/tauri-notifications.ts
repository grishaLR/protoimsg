/**
 * Tauri native notification helpers.
 * Dynamically imported only when IS_TAURI is true — web builds never bundle this.
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

let permissionChecked = false;
let hasPermission = false;

/** Request notification permission on first use. */
export async function requestNativePermission(): Promise<boolean> {
  if (permissionChecked) return hasPermission;
  permissionChecked = true;
  hasPermission = await isPermissionGranted();
  if (!hasPermission) {
    const result = await requestPermission();
    hasPermission = result === 'granted';
  }
  return hasPermission;
}

/** Send a native OS notification. Requests permission on first call. */
export async function sendNativeNotification(title: string, body: string): Promise<void> {
  const granted = await requestNativePermission();
  if (!granted) return;
  sendNotification({ title, body });
}
