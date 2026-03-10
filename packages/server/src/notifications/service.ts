import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { Sql } from '../db/client.js';
import { createLogger } from '../logger.js';

const log = createLogger('notifications');

const expo = new Expo();

export interface NotificationService {
  registerToken(did: string, token: string, platform: string): Promise<void>;
  unregisterToken(did: string, token: string): Promise<void>;
  unregisterAllForDid(did: string): Promise<void>;
  sendNotification(
    did: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void>;
}

export function createNotificationService(sql: Sql): NotificationService {
  async function registerToken(did: string, token: string, platform: string): Promise<void> {
    if (!Expo.isExpoPushToken(token)) {
      log.warn({ did, token }, 'Invalid Expo push token');
      return;
    }
    await sql`
      INSERT INTO device_tokens (did, token, platform) VALUES (${did}, ${token}, ${platform})
      ON CONFLICT (token) DO UPDATE SET did = ${did}, platform = ${platform}, updated_at = NOW()
    `;
    log.info({ did, platform }, 'Device token registered');
  }

  async function unregisterToken(did: string, token: string): Promise<void> {
    await sql`DELETE FROM device_tokens WHERE did = ${did} AND token = ${token}`;
  }

  async function unregisterAllForDid(did: string): Promise<void> {
    const result = await sql`DELETE FROM device_tokens WHERE did = ${did}`;
    if (result.count > 0) {
      log.info({ did, count: result.count }, 'All device tokens removed');
    }
  }

  async function sendNotification(
    did: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    const tokens = await sql<{ token: string }[]>`
      SELECT token FROM device_tokens WHERE did = ${did}
    `;

    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: data ?? {},
      }));

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
        // Clean up invalid tokens
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (
            ticket &&
            ticket.status === 'error' &&
            'details' in ticket &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            const invalidToken = (chunk[i] as { to: string }).to;
            log.info({ token: invalidToken }, 'Removing invalid device token');
            await sql`DELETE FROM device_tokens WHERE token = ${invalidToken}`;
          }
        }
      } catch (err) {
        log.error({ err }, 'Failed to send push notifications');
      }
    }
  }

  return { registerToken, unregisterToken, unregisterAllForDid, sendNotification };
}
