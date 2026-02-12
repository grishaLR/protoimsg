/**
 * Seed script for development database.
 * Inserts sample rooms and messages so new contributors can test the app.
 * Run after migrations: pnpm --filter @protoimsg/server db:migrate && pnpm --filter @protoimsg/server db:seed
 */
import { loadConfig } from '../config.js';
import { initLogger, createLogger } from '../logger.js';
import { createDb } from './client.js';
import { createRoom } from '../rooms/queries.js';
import { insertMessage } from '../messages/queries.js';
import type { Sql } from './client.js';

const SEED_DID = 'did:plc:seed1234567890abcdef';
const NSID_ROOM = 'app.protoimsg.chat.room';
const NSID_MESSAGE = 'app.protoimsg.chat.message';

function atUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

const SAMPLE_ROOMS = [
  {
    id: 'seed-general',
    name: 'General',
    description: 'A place for general discussion. Say hello!',
    topic: 'Welcome to protoimsg',
    purpose: 'discussion' as const,
    visibility: 'public' as const,
  },
  {
    id: 'seed-help',
    name: 'Help & Support',
    description: 'Get help with protoimsg. Ask questions, share tips.',
    topic: 'Getting started',
    purpose: 'support' as const,
    visibility: 'public' as const,
  },
  {
    id: 'seed-offtopic',
    name: 'Off-Topic',
    description: 'Anything goes. Memes, hobbies, random chat.',
    topic: 'Having fun',
    purpose: 'community' as const,
    visibility: 'public' as const,
  },
];

const SAMPLE_MESSAGES: Record<string, string[]> = {
  'seed-general': [
    'Welcome to protoimsg! \ud83d\udc4b',
    'This is a sample room. The seed script populated this for local development.',
    'Feel free to explore, create rooms, and chat. Your data is local to your dev DB.',
  ],
  'seed-help': [
    'Need help? Ask here!',
    'Check the README and CONTRIBUTING.md for setup instructions.',
    'The server runs on port 3000 by default. Web app on 5173.',
  ],
  'seed-offtopic': ['Off-topic chatter goes here!', 'What are you building today?'],
};

async function seedRooms(sql: Sql, log: ReturnType<typeof createLogger>): Promise<void> {
  const now = new Date().toISOString();
  for (const room of SAMPLE_ROOMS) {
    await createRoom(sql, {
      id: room.id,
      uri: atUri(SEED_DID, NSID_ROOM, room.id),
      did: SEED_DID,
      cid: null,
      name: room.name,
      topic: room.topic,
      description: room.description,
      purpose: room.purpose,
      visibility: room.visibility,
      minAccountAgeDays: 0,
      slowModeSeconds: 0,
      allowlistEnabled: false,
      createdAt: now,
    });
  }
  log.info({ count: SAMPLE_ROOMS.length }, 'Seeded rooms');
}

async function seedMessages(sql: Sql, log: ReturnType<typeof createLogger>): Promise<void> {
  let count = 0;
  const baseTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
  for (const [roomId, texts] of Object.entries(SAMPLE_MESSAGES)) {
    for (let i = 0; i < texts.length; i++) {
      const msgId = `seed-msg-${roomId}-${i}`;
      const createdAt = new Date(baseTime + count * 60 * 1000).toISOString();
      await insertMessage(sql, {
        id: msgId,
        uri: atUri(SEED_DID, NSID_MESSAGE, msgId),
        did: SEED_DID,
        cid: null,
        roomId,
        text: texts[i] ?? '',
        createdAt,
      });
      count++;
    }
  }
  log.info({ count }, 'Seeded messages');
}

async function seed(): Promise<void> {
  const config = loadConfig();
  initLogger(config);
  const log = createLogger('seed');
  const sql = createDb(config.DATABASE_URL);

  log.info('Seeding development database...');

  await seedRooms(sql, log);
  await seedMessages(sql, log);

  log.info('Seed complete');
  await sql.end();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
