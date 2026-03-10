import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { authFetch } from './api';

// Show notifications when app is in foreground — suppress if already on the relevant screen
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

/**
 * Request push notification permissions and register the Expo push token
 * with the server. Should be called after login.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== Notifications.PermissionStatus.GRANTED) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      console.info('Push notification permission not granted');
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    const res = await authFetch('/api/device-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform }),
    });

    if (!res.ok) {
      console.warn(`Failed to register push token: ${res.status}`);
      return;
    }

    console.info('Push token registered');
  } catch (err) {
    console.warn('Push notification registration failed:', err);
  }
}

/**
 * Unregister the current device's push token from the server.
 * Should be called on logout.
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await authFetch('/api/device-tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    console.info('Push token unregistered');
  } catch (err) {
    console.warn('Push token unregister failed:', err);
  }
}

/** Validate DID format (did:plc:xxx or did:web:xxx) */
function isValidDid(value: string): boolean {
  return /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(value);
}

/** Validate room ID (alphanumeric/dash/underscore) */
function isValidRoomId(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 128;
}

/**
 * Handle notification tap — navigate to the relevant screen.
 */
function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const data = response.notification.request.content.data as
    | Record<string, string | undefined>
    | undefined;
  if (!data) return;

  const did = data.senderDid ?? data.did;
  if (data.type === 'dm' && did && isValidDid(did)) {
    router.push(`/dm/${did}`);
  } else if (data.type === 'call' && did && isValidDid(did)) {
    router.push(`/call/${did}`);
  } else if (data.type === 'mention' && data.roomId && isValidRoomId(data.roomId)) {
    router.push(`/room/${data.roomId}`);
  }
}

/**
 * Set up the notification response listener (tap-to-navigate).
 * Returns a cleanup function.
 */
export function setupNotificationResponseListener(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    handleNotificationResponse,
  );

  // Handle the case where the app was opened from a killed state by tapping a notification
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      handleNotificationResponse(response);
    }
  });

  return () => {
    subscription.remove();
  };
}
