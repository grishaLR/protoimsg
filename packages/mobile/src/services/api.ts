import { API_URL } from './config';
import { getStoredToken, setStoredToken } from './storage';
import type { RoomView, MessageView, PollView } from '@/types';

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

// -- Translation --

export interface TranslateResponseItem {
  text: string;
  translated: string;
  sourceLang: string;
}

export interface TranslateResponse {
  translations: TranslateResponseItem[];
  rateLimited?: boolean;
}

export interface TranslateStatusResponse {
  available: boolean;
  languages: string[];
}

export async function translateTexts(
  texts: string[],
  targetLang: string,
): Promise<TranslateResponse> {
  const res = await authFetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, targetLang }),
  });
  if (!res.ok) {
    return {
      translations: texts.map((text) => ({ text, translated: text, sourceLang: 'unknown' })),
    };
  }
  return (await res.json()) as TranslateResponse;
}

export async function fetchTranslateStatus(): Promise<TranslateStatusResponse> {
  try {
    const res = await authFetch('/api/translate/status');
    if (!res.ok) return { available: false, languages: [] };
    return (await res.json()) as TranslateStatusResponse;
  } catch {
    return { available: false, languages: [] };
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

// -- Channel polls --

export async function fetchChannelPolls(
  roomId: string,
  channelId: string,
  opts?: { signal?: AbortSignal },
): Promise<PollView[]> {
  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/channels/${encodeURIComponent(channelId)}/polls`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch channel polls: ${res.status}`);
  const data = (await res.json()) as { polls: PollView[] };
  return data.polls;
}

// -- Thread messages --

export async function fetchChannelThreadMessages(
  roomId: string,
  channelId: string,
  rootUri: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<MessageView[]> {
  const params = new URLSearchParams();
  params.set('root', rootUri);
  if (opts?.limit) params.set('limit', String(opts.limit));

  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/channels/${encodeURIComponent(channelId)}/threads?${params.toString()}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch channel thread: ${res.status}`);
  const data = (await res.json()) as { messages: MessageView[] };
  return data.messages;
}

// -- Content reports --

export async function sendContentReport(report: {
  subjectUri: string;
  roomId?: string;
  category: string;
  description?: string;
}): Promise<void> {
  const res = await authFetch('/api/feedback/report-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Failed to submit report');
  }
}
