import { Alert, Linking, Platform, PermissionsAndroid } from 'react-native';

export interface MediaPermissionResult {
  camera: boolean;
  mic: boolean;
}

/**
 * Request camera + microphone permissions.
 * - Android: uses PermissionsAndroid API
 * - iOS: no pre-check API; permissions are requested by getUserMedia itself
 */
export async function requestMediaPermissions(): Promise<MediaPermissionResult> {
  if (Platform.OS !== 'android') {
    // iOS: permissions are triggered by getUserMedia, not requestable separately
    return { camera: true, mic: true };
  }

  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);

  return {
    camera: result[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
    mic: result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
  };
}

/**
 * Check camera + mic permission status without prompting (Android only).
 */
export async function checkMediaPermissions(): Promise<MediaPermissionResult> {
  if (Platform.OS !== 'android') {
    return { camera: true, mic: true };
  }

  const [camera, mic] = await Promise.all([
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
  ]);

  return { camera, mic };
}

/**
 * Detect whether a getUserMedia error is a permission denial.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name || '';
  const msg = err.message || '';
  return (
    name === 'NotAllowedError' ||
    name === 'NotReadableError' ||
    msg.includes('permission') ||
    msg.includes('denied') ||
    msg.includes('not allowed')
  );
}

/**
 * Show an alert directing the user to app settings for camera/mic permissions.
 * Returns a promise that resolves when the alert is dismissed.
 */
export function showPermissionDeniedAlert(
  title: string,
  message: string,
  settingsLabel: string,
  cancelLabel: string,
): void {
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: settingsLabel, onPress: () => void Linking.openSettings() },
  ]);
}

/**
 * Opens the device's app settings page.
 */
export function openAppSettings(): void {
  void Linking.openSettings();
}
