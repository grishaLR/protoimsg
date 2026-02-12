/**
 * Integration test: real DB connection.
 * Requires DATABASE_URL (e.g. CI or local Docker Postgres).
 * Skipped when DATABASE_URL is not set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Sql } from './client.js';
import { createDb } from './client.js';
import { createRoom, getRoomById } from '../rooms/queries.js';
import { insertMessage, getMessagesByRoom } from '../messages/queries.js';
import { createDmService } from '../dms/service.js';

const DATABASE_URL = process.env.DATABASE_URL;
const skipIntegration = !DATABASE_URL || DATABASE_URL.includes('undefined');
const sql: Sql | null = !skipIntegration && DATABASE_URL ? createDb(DATABASE_URL) : null;

afterAll(async () => {
  if (sql) await sql.end();
});

describe('DB integration', () => {
  it.skipIf(skipIntegration)('connects and can run a query', async () => {
    if (!sql) throw new Error('No DB client');
    const [{ ok }] = await sql.unsafe<[{ ok: number }]>('SELECT 1 as ok');
    expect(ok).toBe(1);
  });

  it.skipIf(skipIntegration)('has schema_migrations table after migrate', async () => {
    if (!sql) throw new Error('No DB client');
    const rows = await sql.unsafe<{ version: string }[]>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Room and message flow', () => {
  it.skipIf(skipIntegration)('create room, insert message, read back', async () => {
    if (!sql) throw new Error('No DB client');
    const roomId = `test-room-${randomUUID().slice(0, 8)}`;
    const roomUri = `at://did:plc:test/app.protoimsg.chat.room/${roomId}`;
    const did = 'did:plc:integration-test';
    const now = new Date().toISOString();

    await createRoom(sql, {
      id: roomId,
      uri: roomUri,
      did,
      cid: null,
      name: 'Integration test room',
      description: 'For DB integration tests',
      purpose: 'discussion',
      topic: 'Testing',
      visibility: 'public',
      minAccountAgeDays: 0,
      slowModeSeconds: 0,
      allowlistEnabled: false,
      createdAt: now,
    });

    const room = await getRoomById(sql, roomId);
    expect(room).toBeDefined();
    expect(room?.name).toBe('Integration test room');

    const msgId = `test-msg-${randomUUID().slice(0, 8)}`;
    const msgUri = `at://${did}/app.protoimsg.chat.message/${msgId}`;
    await insertMessage(sql, {
      id: msgId,
      uri: msgUri,
      did,
      cid: null,
      roomId,
      text: 'Hello from integration test',
      createdAt: now,
    });

    const messages = await getMessagesByRoom(sql, roomId, { limit: 10 });
    expect(messages.length).toBe(1);
    expect(messages[0]?.text).toBe('Hello from integration test');
    expect(messages[0]?.room_id).toBe(roomId);
  });
});

describe('DM lifecycle', () => {
  it.skipIf(skipIntegration)(
    'open conversation, send message, open again and see message',
    async () => {
      if (!sql) throw new Error('No DB client');
      const dmService = createDmService(sql);
      const alice = 'did:plc:alice-integration';
      const bob = 'did:plc:bob-integration';

      const { conversation } = await dmService.openConversation(alice, bob);
      expect(conversation.did_1).toBeDefined();
      expect(conversation.did_2).toBeDefined();
      expect(conversation.id).toBeDefined();

      const { message, recipientDid } = await dmService.sendMessage(
        conversation.id,
        alice,
        'Hi from integration test',
      );
      expect(message.text).toBe('Hi from integration test');
      expect(recipientDid).toBe(bob);

      const { messages } = await dmService.openConversation(alice, bob);
      expect(messages.length).toBe(0); // default persist is false, so history not loaded

      await dmService.togglePersist(conversation.id, alice, true);
      const { messages: persisted } = await dmService.openConversation(alice, bob);
      expect(persisted.length).toBe(1);
      expect(persisted[0]?.text).toBe('Hi from integration test');
    },
  );
});
