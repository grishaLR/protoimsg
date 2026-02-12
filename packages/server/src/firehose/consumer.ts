import WebSocket from 'ws';
import { NSID_PREFIX } from '@protoimsg/shared';
import type { Sql, JsonValue } from '../db/client.js';
import { getCursor, saveCursor } from './cursor.js';
import { createHandlers, type FirehoseEvent } from './handlers.js';
import type { WsServer } from '../ws/server.js';
import type { PresenceService } from '../presence/service.js';
import type { SessionStore } from '../auth/session.js';

/** Jetstream event structures */
interface JetstreamCommitEvent {
  did: string;
  time_us: number;
  kind: 'commit';
  commit: {
    rev: string;
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    record?: unknown;
    cid?: string;
  };
}

interface JetstreamIdentityEvent {
  did: string;
  time_us: number;
  kind: 'identity';
  identity: {
    did: string;
    handle?: string;
    seq: number;
    time: string;
  };
}

interface JetstreamAccountEvent {
  did: string;
  time_us: number;
  kind: 'account';
  account: {
    active: boolean;
    did: string;
    seq: number;
    time: string;
    status?: string;
  };
}

type JetstreamEvent = JetstreamCommitEvent | JetstreamIdentityEvent | JetstreamAccountEvent;

export interface FirehoseConsumer {
  start: () => void;
  stop: () => Promise<void>;
}

const RECONNECT_DELAY_MS = 3000;
const CURSOR_SAVE_INTERVAL = 100;
/** Jetstream retains ~72 hours of events. Beyond this, events are permanently lost. */
const CURSOR_STALENESS_THRESHOLD_US = 72 * 60 * 60 * 1_000_000;

export function createFirehoseConsumer(
  jetstreamUrl: string,
  db: Sql,
  wss: WsServer,
  presenceService: PresenceService,
  sessions: SessionStore,
): FirehoseConsumer {
  const handlers = createHandlers(db, wss);
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let eventCount = 0;
  let lastCursor: number | undefined;

  function connect(cursor: number | undefined) {
    // Staleness check: warn if cursor is beyond Jetstream's retention window
    if (cursor) {
      const nowUs = Date.now() * 1000;
      const ageUs = nowUs - cursor;
      if (ageUs > CURSOR_STALENESS_THRESHOLD_US) {
        const ageHours = Math.round(ageUs / 3_600_000_000);
        console.warn(
          `⚠ Jetstream cursor is ${String(ageHours)}h old (retention ~72h). Events may have been lost. Consider a backfill.`,
        );
      }
    }

    const url = new URL(jetstreamUrl);
    url.searchParams.set('wantedCollections', NSID_PREFIX + '*');
    if (cursor) {
      url.searchParams.set('cursor', String(cursor));
    }

    console.info(`Connecting to Jetstream: ${url.toString()}`);
    ws = new WebSocket(url.toString());

    ws.on('open', () => {
      console.info('Jetstream connected');
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString('utf-8')) as JetstreamEvent;
        lastCursor = event.time_us;

        if (event.kind === 'identity') {
          const newHandle = event.identity.handle;
          if (newHandle && newHandle !== 'handle.invalid') {
            // Only act + log for DIDs with active sessions in our app
            if (sessions.hasDid(event.did)) {
              sessions.updateHandle(event.did, newHandle);
              console.info(`Identity update: ${event.did} → ${newHandle}`);
            }
          }
          return;
        }

        if (event.kind === 'account') {
          if (!event.account.active) {
            // Only act + log for DIDs with active sessions or presence
            const hadSession = sessions.revokeByDid(event.did);
            presenceService.handleUserDisconnect(event.did);
            if (hadSession) {
              console.info(
                `Account ${event.account.status ?? 'deactivated'}: ${event.did} — sessions revoked`,
              );
            }
          }
          return;
        }

        const { commit } = event;
        const handler = handlers[commit.collection];
        if (!handler) return;

        const uri = `at://${event.did}/${commit.collection}/${commit.rkey}`;

        // Deletes carry no record or CID (ATProto spec)
        if (commit.operation !== 'delete' && !commit.record) return;

        const firehoseEvent: FirehoseEvent = {
          did: event.did,
          collection: commit.collection,
          rkey: commit.rkey,
          record: commit.operation === 'delete' ? null : commit.record,
          uri,
          cid: commit.operation === 'delete' ? null : (commit.cid ?? null),
          operation: commit.operation,
        };

        void (async () => {
          // Generic records table — ATProto convention: universal audit trail
          if (commit.operation === 'delete') {
            await db`DELETE FROM records WHERE uri = ${uri}`;
          } else {
            await db`
              INSERT INTO records (uri, cid, did, collection, json, indexed_at)
              VALUES (${uri}, ${firehoseEvent.cid}, ${event.did}, ${commit.collection}, ${db.json(commit.record as JsonValue)}, NOW())
              ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                json = EXCLUDED.json,
                indexed_at = NOW()
            `;
          }
          // Collection-specific indexing
          await handler(firehoseEvent);
        })().catch((err: unknown) => {
          console.error(`Error handling ${commit.collection} event:`, err);
        });

        // Save cursor periodically
        eventCount++;
        if (eventCount % CURSOR_SAVE_INTERVAL === 0) {
          void saveCursor(db, lastCursor);
        }
      } catch (err) {
        console.error('Error parsing Jetstream event:', err);
      }
    });

    ws.on('close', () => {
      console.info('Jetstream disconnected');
      ws = null;
      if (shouldReconnect) {
        // Save cursor before reconnect
        if (lastCursor !== undefined) {
          void saveCursor(db, lastCursor);
        }
        console.info(`Reconnecting in ${String(RECONNECT_DELAY_MS)}ms...`);
        setTimeout(() => {
          connect(lastCursor);
        }, RECONNECT_DELAY_MS);
      }
    });

    ws.on('error', (err) => {
      console.error('Jetstream error:', err);
    });
  }

  return {
    start: () => {
      shouldReconnect = true;
      void getCursor(db).then((cursor) => {
        connect(cursor);
      });
    },

    async stop(): Promise<void> {
      shouldReconnect = false;
      if (lastCursor !== undefined) {
        await saveCursor(db, lastCursor);
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      console.info('Jetstream consumer stopped');
    },
  };
}
