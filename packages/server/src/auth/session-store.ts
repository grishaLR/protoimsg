export interface Session {
  did: string;
  handle: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore {
  create(did: string, handle: string, ttlMs?: number): Promise<string>;
  get(token: string): Promise<Session | undefined>;
  delete(token: string): Promise<void>;
  hasDid(did: string): Promise<boolean>;
  updateHandle(did: string, newHandle: string): Promise<void>;
  revokeByDid(did: string): Promise<boolean>;
  prune(): Promise<number>;
}
