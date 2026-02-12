import { randomUUID } from 'crypto';
import type { Session, SessionStore } from './session-store.js';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    if (ttlMs <= 0) {
      throw new Error('Session TTL must be greater than 0');
    }
    this.ttlMs = ttlMs;
  }

  create(did: string, handle: string, ttlMs?: number): Promise<string> {
    const token = randomUUID();
    const now = Date.now();
    this.sessions.set(token, {
      did,
      handle,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
    });
    return Promise.resolve(token);
  }

  get(token: string): Promise<Session | undefined> {
    const session = this.sessions.get(token);
    if (!session) return Promise.resolve(undefined);
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(session);
  }

  delete(token: string): Promise<void> {
    this.sessions.delete(token);
    return Promise.resolve();
  }

  hasDid(did: string): Promise<boolean> {
    for (const session of this.sessions.values()) {
      if (session.did === did) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  updateHandle(did: string, newHandle: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.did === did) {
        session.handle = newHandle;
      }
    }
    return Promise.resolve();
  }

  revokeByDid(did: string): Promise<boolean> {
    let revoked = false;
    for (const [token, session] of this.sessions) {
      if (session.did === did) {
        this.sessions.delete(token);
        revoked = true;
      }
    }
    return Promise.resolve(revoked);
  }

  prune(): Promise<number> {
    const now = Date.now();
    let pruned = 0;
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(token);
        pruned++;
      }
    }
    return Promise.resolve(pruned);
  }
}
