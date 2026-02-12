import { randomUUID } from 'crypto';

/**
 * MVP limitation: Sessions are in-memory only. They are lost on server restart
 * and cannot be shared across multiple instances. For production, persist
 * sessions to Redis or Postgres.
 */

export interface Session {
  did: string;
  handle: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export class SessionStore {
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(did: string, handle: string, ttlMs?: number): string {
    const token = randomUUID();
    const now = Date.now();
    this.sessions.set(token, {
      did,
      handle,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
    });
    return token;
  }

  get(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  delete(token: string): void {
    this.sessions.delete(token);
  }

  /** Check if any active session exists for a DID. */
  hasDid(did: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.did === did) return true;
    }
    return false;
  }

  /** Update handle for all sessions belonging to a DID (e.g. after identity event). */
  updateHandle(did: string, newHandle: string): void {
    for (const session of this.sessions.values()) {
      if (session.did === did) {
        session.handle = newHandle;
      }
    }
  }

  /** Revoke all sessions for a DID. Returns true if any were revoked. */
  revokeByDid(did: string): boolean {
    let revoked = false;
    for (const [token, session] of this.sessions) {
      if (session.did === did) {
        this.sessions.delete(token);
        revoked = true;
      }
    }
    return revoked;
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(token);
        pruned++;
      }
    }
    return pruned;
  }
}
