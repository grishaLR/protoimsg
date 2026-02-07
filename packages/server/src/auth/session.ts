/** Simple in-memory session storage. Replace with Redis/DB for production. */

interface Session {
  did: string;
  handle: string;
  createdAt: Date;
}

const sessions = new Map<string, Session>();

export function createSession(token: string, did: string, handle: string): void {
  sessions.set(token, { did, handle, createdAt: new Date() });
}

export function getSession(token: string): Session | undefined {
  return sessions.get(token);
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}
