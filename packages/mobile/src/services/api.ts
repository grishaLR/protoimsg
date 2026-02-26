import { API_URL } from './config';
import { getStoredToken, setStoredToken } from './storage';
import type { RoomView, MessageView } from '@/types';

// -- In-memory token cache (mirrors stored value) --

let serverToken: string | null = getStoredToken();

export function setServerToken(token: string | null): void {
  serverToken = token;
  setStoredToken(token);
}

export function getServerToken(): string | null {
  return serverToken;
}

// -- Error types --

export class AccountBannedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountBannedError';
  }
}

export class NotOnAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotOnAllowlistError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function throwForbiddenError(data: { error: string; errorCode?: string }): never {
  if (data.errorCode === 'NOT_ON_ALLOWLIST') {
    throw new NotOnAllowlistError(data.error);
  }
  throw new AccountBannedError(data.error);
}

// -- Auth endpoints --

export async function preflightCheck(handle: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/preflight?handle=${encodeURIComponent(handle)}`);
  if (res.status === 403) {
    const data = (await res.json()) as { error: string; errorCode?: string };
    throwForbiddenError(data);
  }
}

export async function fetchChallenge(did: string): Promise<{ nonce: string }> {
  const res = await fetch(`${API_URL}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did }),
  });
  if (res.status === 403) {
    const data = (await res.json()) as { error: string; errorCode?: string };
    throwForbiddenError(data);
  }
  if (!res.ok) throw new Error(`Failed to get auth challenge: ${res.status}`);
  return (await res.json()) as { nonce: string };
}

export async function createServerSession(
  did: string,
  handle: string,
  nonce: string,
  rkey: string,
): Promise<{ token: string; did: string; handle: string }> {
  const res = await fetch(`${API_URL}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, handle, nonce, rkey }),
  });
  if (res.status === 403) {
    const data = (await res.json()) as { error: string; errorCode?: string };
    throwForbiddenError(data);
  }
  if (!res.ok) throw new Error(`Failed to create server session: ${res.status}`);
  return (await res.json()) as { token: string; did: string; handle: string };
}

export async function deleteServerSession(): Promise<void> {
  if (!serverToken) return;
  await fetch(`${API_URL}/api/auth/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serverToken}` },
  });
}

// -- Auth fetch helper --

/** Callback invoked when the server returns 401 (session expired). */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (serverToken) {
    headers.set('Authorization', `Bearer ${serverToken}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && serverToken) {
    setServerToken(null);
    onSessionExpired?.();
  }
  return res;
}

// -- ICE servers --

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const res = await authFetch('/api/ice-servers');
    if (!res.ok) throw new Error(`ICE server request failed: ${res.status}`);
    const data = (await res.json()) as { iceServers: IceServer[] };
    return data.iceServers;
  } catch {
    // No fallback to third-party STUN — prevents IP address leaks
    return [];
  }
}

// -- Rooms --

export async function fetchRoom(id: string, opts?: { signal?: AbortSignal }): Promise<RoomView> {
  const res = await authFetch(`/api/rooms/${encodeURIComponent(id)}`, { signal: opts?.signal });
  if (!res.ok) {
    if (res.status === 404) throw new NotFoundError('Room not found');
    throw new Error(`Failed to fetch room: ${res.status}`);
  }
  const data = (await res.json()) as { room: RoomView };
  return data.room;
}

// -- Channel messages --

export interface FetchMessagesResult {
  messages: MessageView[];
  replyCounts: Record<string, number>;
}

export async function fetchChannelMessages(
  roomId: string,
  channelId: string,
  opts?: { limit?: number; before?: string; signal?: AbortSignal },
): Promise<FetchMessagesResult> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);

  const qs = params.toString();
  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ''}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch channel messages: ${res.status}`);

  const data = (await res.json()) as {
    messages: MessageView[];
    replyCounts?: Record<string, number>;
  };
  return { messages: data.messages, replyCounts: data.replyCounts ?? {} };
}
