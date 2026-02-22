import WebSocket from 'ws';
import { NSID_PREFIX } from '@protoimsg/shared';
import type { Sql, JsonValue } from '../db/client.js';
import { getCursor, saveCursor } from './cursor.js';
import { createHandlers, type FirehoseEvent } from './handlers.js';
import type { WsServer } from '../ws/server.js';
import type { PresenceService } from '../presence/service.js';
import type { LabelerService } from '../moderation/labeler-service.js';
import type { SessionStore } from '../auth/session-store.js';
import { createLogger } from '../logger.js';
import { Sentry } from '../sentry.js';
import {
  setJetstreamConnected,
  setJetstreamLag,
  incJetstreamEvent,
  incJetstreamError,
} from '../metrics.js';

const log = createLogger('firehose');

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
  isConnected: () => boolean;
  /** Force failover to the next Jetstream instance (admin use). */
  failover: () => void;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const CURSOR_SAVE_INTERVAL = 100;
/** Jetstream retains ~72 hours of events. Beyond this, events are permanently lost. */
const CURSOR_STALENESS_THRESHOLD_US = 72 * 60 * 60 * 1_000_000;
/** Failover if the WebSocket goes completely silent (no events at all). */
const CONNECTION_LIVENESS_TIMEOUT_MS = 30_000;
/** Failover if commits stop arriving while other events still flow (silent drop). */
const COMMIT_LIVENESS_TIMEOUT_MS = 5 * 60 * 1000;

export function createFirehoseConsumer(
  jetstreamUrls: string[],
  db: Sql,
  wss: WsServer,
  presenceService: PresenceService,
  sessions: SessionStore,
  labelerService: LabelerService,
): FirehoseConsumer {
  const handlers = createHandlers(db, wss, presenceService, labelerService);
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let eventCount = 0;
  let lastCursor: number | undefined;
  /** Sequential processing queue — prevents unbounded DB concurrency */
  let processQueue: Promise<void> = Promise.resolve();
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  /** Last time ANY event was received (proves the WS connection is alive). */
  let lastEventAt = 0;
  /** Last time a commit event with a matching handler was received. */
  let lastCommitAt = 0;
  let livenessTimer: ReturnType<typeof setInterval> | null = null;
  /** Index into jetstreamUrls for round-robin failover. */
  let urlIndex = 0;

  function currentUrl(): string {
    return jetstreamUrls[urlIndex % jetstreamUrls.length] as string;
  }

  /** Rotate to the next Jetstream instance. Returns true if we wrapped around. */
  function rotateUrl(): boolean {
    urlIndex++;
    const wrapped = urlIndex >= jetstreamUrls.length;
    urlIndex = urlIndex % jetstreamUrls.length;
    return wrapped;
  }

  function failover() {
    if (!shouldReconnect) return;

    const prev = currentUrl();
    const wrapped = rotateUrl();
    const next = currentUrl();

    // Log cursor age so we can audit if any events were missed between
    // "last received" and "failover triggered". The new instance should
    // have them if the cursor is within the 72h retention window.
    const cursorAgeSecs = lastCursor
      ? Math.round((Date.now() * 1000 - lastCursor) / 1_000_000)
      : null;

    log.warn(
      { from: prev, to: next, wrapped, cursorAgeSecs },
      'Jetstream liveness timeout — failing over to next instance',
    );

    if (wrapped) {
      // All instances tried — alert Sentry
      Sentry.captureMessage(
        `All Jetstream instances exhausted — cycling back to ${next}. Federation may be degraded.`,
        {
          level: 'error',
          tags: { component: 'firehose' },
          extra: { urls: jetstreamUrls, lastCommitAt, cursorAgeSecs },
        },
      );
    }

    // Close current connection — the 'close' handler will reconnect to the new URL
    if (ws) {
      ws.close();
    }
  }

  function connect(cursor: number | undefined) {
    const jetstreamUrl = currentUrl();

    // Staleness check: warn if cursor is beyond Jetstream's retention window
    if (cursor) {
      const nowUs = Date.now() * 1000;
      const ageUs = nowUs - cursor;
      if (ageUs > CURSOR_STALENESS_THRESHOLD_US) {
        const ageHours = Math.round(ageUs / 3_600_000_000);
        log.warn(
          { ageHours },
          'Jetstream cursor is stale (retention ~72h) — events may have been lost',
        );
      }
    }

    const url = new URL(jetstreamUrl);
    url.searchParams.set('wantedCollections', NSID_PREFIX + '*');
    if (cursor) {
      url.searchParams.set('cursor', String(cursor));
    }

    log.info({ url: url.toString() }, 'Connecting to Jetstream');
    ws = new WebSocket(url.toString());

    ws.on('open', () => {
      setJetstreamConnected(true);
      log.info({ instance: jetstreamUrl }, 'Jetstream connected');
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      lastEventAt = Date.now();
      lastCommitAt = Date.now();

      // Dual liveness watchdog — two failure modes, two timeouts:
      //
      // 1. CONNECTION_LIVENESS (30s): No events at all (not even identity/account).
      //    The WebSocket is dead or the instance is down. Fast failover.
      //
      // 2. COMMIT_LIVENESS (5min): Identity/account events still flowing, but
      //    commits silently missing. This is the EXACT bug we hit: us-east
      //    Jetstream stopped propagating commits from us-west PDS instances
      //    while identity events kept flowing. Slower check because low-traffic
      //    periods naturally have no commits.
      if (livenessTimer) clearInterval(livenessTimer);
      livenessTimer = setInterval(() => {
        const now = Date.now();
        const eventSilenceMs = now - lastEventAt;
        const commitSilenceMs = now - lastCommitAt;

        if (eventSilenceMs > CONNECTION_LIVENESS_TIMEOUT_MS) {
          log.warn(
            { silenceMs: eventSilenceMs },
            'No events received — connection appears dead, failing over',
          );
          failover();
        } else if (commitSilenceMs > COMMIT_LIVENESS_TIMEOUT_MS) {
          // Don't auto-failover — 5min of no commits is normal during quiet
          // hours for a small app. Just alert so we can investigate.
          log.warn(
            { commitSilenceMs, lastEventAgoMs: eventSilenceMs, instance: currentUrl() },
            'Events flowing but no commits — possible silent drop',
          );
          Sentry.captureMessage(
            `Jetstream commit silence on ${currentUrl()} — events flowing but no commits for ${Math.round(commitSilenceMs / 1000)}s`,
            {
              level: 'warning',
              tags: { component: 'firehose' },
              extra: { commitSilenceMs, eventSilenceMs, instance: currentUrl() },
            },
          );
        }
      }, CONNECTION_LIVENESS_TIMEOUT_MS);
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString('utf-8')) as JetstreamEvent;
        lastCursor = event.time_us;
        lastEventAt = Date.now();
        setJetstreamLag((Date.now() * 1000 - event.time_us) / 1_000_000);

        if (event.kind === 'identity') {
          const newHandle = event.identity.handle;
          if (newHandle && newHandle !== 'handle.invalid') {
            void (async () => {
              // Only act + log for DIDs with active sessions in our app
              if (await sessions.hasDid(event.did)) {
                await sessions.updateHandle(event.did, newHandle);
                log.info({ did: event.did, handle: newHandle }, 'Identity update');
              }
            })().catch((err: unknown) => {
              Sentry.withScope((scope) => {
                scope.setUser({ id: event.did });
                Sentry.captureException(err);
              });
              log.error({ err }, 'Error handling identity event');
            });
          }
          return;
        }

        if (event.kind === 'account') {
          if (!event.account.active) {
            void (async () => {
              // Only act + log for DIDs with active sessions or presence
              const hadSession = await sessions.revokeByDid(event.did);
              await presenceService.handleUserDisconnect(event.did);
              if (hadSession) {
                log.info(
                  { did: event.did, status: event.account.status ?? 'deactivated' },
                  'Account deactivated — sessions revoked',
                );
              }
            })().catch((err: unknown) => {
              Sentry.withScope((scope) => {
                scope.setUser({ id: event.did });
                Sentry.captureException(err);
              });
              log.error({ err }, 'Error handling account event');
            });
          }
          return;
        }

        const { commit } = event;
        lastCommitAt = Date.now();
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

        // Serialize processing to prevent unbounded DB concurrency.
        // Each event waits for the previous to finish before starting.
        // Errors are caught per-event so the queue continues.
        processQueue = processQueue.then(async () => {
          try {
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
            incJetstreamEvent(commit.collection, commit.operation);

            // Save cursor periodically. Awaited inside the async block so the
            // cursor on disk always reflects events that have been processed.
            // On crash, we may re-process up to CURSOR_SAVE_INTERVAL events —
            // all handlers use upsert (ON CONFLICT) so replays are idempotent.
            eventCount++;
            if (eventCount % CURSOR_SAVE_INTERVAL === 0) {
              await saveCursor(db, event.time_us);
            }
          } catch (err: unknown) {
            incJetstreamError();
            Sentry.withScope((scope) => {
              scope.setUser({ id: event.did });
              scope.setTag('collection', commit.collection);
              Sentry.captureException(err);
            });
            log.error({ err, collection: commit.collection }, 'Error handling commit event');
          }
        });
      } catch (err) {
        Sentry.captureException(err);
        log.error({ err }, 'Error parsing Jetstream event');
      }
    });

    ws.on('close', () => {
      setJetstreamConnected(false);
      if (livenessTimer) {
        clearInterval(livenessTimer);
        livenessTimer = null;
      }
      log.info('Jetstream disconnected');
      ws = null;
      if (shouldReconnect) {
        // Save cursor before reconnect
        if (lastCursor !== undefined) {
          void saveCursor(db, lastCursor);
        }
        const jitter = Math.random() * 1000;
        const delay = reconnectDelay + jitter;
        log.info({ delayMs: Math.round(delay), instance: currentUrl() }, 'Reconnecting...');
        setTimeout(() => {
          connect(lastCursor);
        }, delay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      }
    });

    ws.on('error', (err) => {
      Sentry.captureException(err);
      log.error({ err }, 'Jetstream error');
    });
  }

  return {
    isConnected: () => ws !== null && ws.readyState === WebSocket.OPEN,
    failover,

    start: () => {
      shouldReconnect = true;
      void getCursor(db).then((cursor) => {
        connect(cursor);
      });
    },

    async stop(): Promise<void> {
      shouldReconnect = false;
      if (livenessTimer) {
        clearInterval(livenessTimer);
        livenessTimer = null;
      }
      if (lastCursor !== undefined) {
        await saveCursor(db, lastCursor);
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      // Wait for any in-flight event handlers to complete before shutdown
      await processQueue;
      log.info('Jetstream consumer stopped');
    },
  };
}
