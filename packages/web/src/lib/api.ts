import type { RoomView, MessageView, DmConversationView, DmMessageView } from '../types';
import { API_URL } from './config.js';

// -- Token management --
// Token is kept in-memory and also in localStorage so Tauri child windows
// can read it on mount without an IPC handshake (shared origin = shared storage).

const TOKEN_STORAGE_KEY = 'protoimsg:server_token';

let serverToken: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

export function setServerToken(token: string | null): void {
  serverToken = token;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getServerToken(): string | null {
  return serverToken;
}

// -- Server session (challenge-response auth) --

interface ChallengeResponse {
  nonce: string;
}

export class AccountBannedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountBannedError';
  }
}

/** Pre-OAuth ban check — throws AccountBannedError if the handle is banned. */
export async function preflightCheck(handle: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/preflight?handle=${encodeURIComponent(handle)}`);
  if (res.status === 403) {
    const data = (await res.json()) as { error: string };
    throw new AccountBannedError(data.error);
  }
}

export async function fetchChallenge(did: string): Promise<ChallengeResponse> {
  const res = await fetch(`${API_URL}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did }),
  });
  if (res.status === 403) {
    const data = (await res.json()) as { error: string };
    throw new AccountBannedError(data.error);
  }
  if (!res.ok) throw new Error(`Failed to get auth challenge: ${res.status}`);
  return (await res.json()) as ChallengeResponse;
}

interface ServerSessionResponse {
  token: string;
  did: string;
  handle: string;
}

export async function createServerSession(
  did: string,
  handle: string,
  nonce: string,
  rkey: string,
): Promise<ServerSessionResponse> {
  const res = await fetch(`${API_URL}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, handle, nonce, rkey }),
  });
  if (!res.ok) throw new Error(`Failed to create server session: ${res.status}`);
  return (await res.json()) as ServerSessionResponse;
}

export async function deleteServerSession(): Promise<void> {
  if (!serverToken) return;
  await fetch(`${API_URL}/api/auth/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serverToken}` },
  });
}

// -- Translate types --

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

// -- Auth fetch helper --

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (serverToken) {
    headers.set('Authorization', `Bearer ${serverToken}`);
  }
  return fetch(`${API_URL}${url}`, { ...init, headers });
}

// -- Rooms --

export async function fetchRooms(opts?: {
  visibility?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<RoomView[]> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));

  const qs = params.toString();
  const res = await authFetch(`/api/rooms${qs ? `?${qs}` : ''}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Failed to fetch rooms: ${res.status}`);

  const data = (await res.json()) as { rooms: RoomView[] };
  return data.rooms;
}

export async function fetchRoom(id: string, opts?: { signal?: AbortSignal }): Promise<RoomView> {
  const res = await authFetch(`/api/rooms/${encodeURIComponent(id)}`, { signal: opts?.signal });
  if (!res.ok) {
    if (res.status === 404) throw new NotFoundError('Room not found');
    throw new Error(`Failed to fetch room: ${res.status}`);
  }

  const data = (await res.json()) as { room: RoomView };
  return data.room;
}

export interface FetchMessagesResult {
  messages: MessageView[];
  replyCounts: Record<string, number>;
}

export async function fetchMessages(
  roomId: string,
  opts?: { limit?: number; before?: string; signal?: AbortSignal },
): Promise<FetchMessagesResult> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);

  const qs = params.toString();
  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/messages${qs ? `?${qs}` : ''}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);

  const data = (await res.json()) as {
    messages: MessageView[];
    replyCounts?: Record<string, number>;
  };
  return { messages: data.messages, replyCounts: data.replyCounts ?? {} };
}

export async function fetchThreadMessages(
  roomId: string,
  rootUri: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<MessageView[]> {
  const params = new URLSearchParams();
  params.set('root', rootUri);
  if (opts?.limit) params.set('limit', String(opts.limit));

  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/threads?${params.toString()}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch thread: ${res.status}`);

  const data = (await res.json()) as { messages: MessageView[] };
  return data.messages;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// -- Presence --

export interface PresenceInfo {
  did: string;
  status: string;
  awayMessage?: string;
}

export async function fetchPresence(
  dids: string[],
  opts?: { signal?: AbortSignal },
): Promise<PresenceInfo[]> {
  if (dids.length === 0) return [];
  const res = await authFetch(`/api/presence?dids=${encodeURIComponent(dids.join(','))}`, {
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch presence: ${res.status}`);
  const data = (await res.json()) as { presence: PresenceInfo[] };
  return data.presence;
}

// -- Buddy List --

export interface BuddyListResponse {
  groups: Array<{
    name: string;
    isInnerCircle?: boolean;
    members: Array<{ did: string; addedAt: string }>;
  }>;
}

export async function fetchBuddyList(
  did: string,
  opts?: { signal?: AbortSignal },
): Promise<BuddyListResponse> {
  const res = await authFetch(`/api/community/${encodeURIComponent(did)}`, {
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch buddy list: ${res.status}`);
  return (await res.json()) as BuddyListResponse;
}

// -- DMs --

export async function fetchDmConversations(opts?: {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<DmConversationView[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));

  const qs = params.toString();
  const res = await authFetch(`/api/dms${qs ? `?${qs}` : ''}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Failed to fetch DM conversations: ${res.status}`);

  const data = (await res.json()) as { conversations: DmConversationView[] };
  return data.conversations;
}

export async function fetchDmMessages(
  conversationId: string,
  opts?: { limit?: number; before?: string; signal?: AbortSignal },
): Promise<DmMessageView[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);

  const qs = params.toString();
  const res = await authFetch(
    `/api/dms/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch DM messages: ${res.status}`);

  const data = (await res.json()) as { messages: DmMessageView[] };
  return data.messages;
}

// -- Translation --

export async function translateTexts(
  texts: string[],
  targetLang: string,
): Promise<TranslateResponse> {
  const res = await authFetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, targetLang }),
  });

  if (res.status === 429) {
    const data = (await res.json()) as TranslateResponse;
    return { ...data, rateLimited: true };
  }

  if (!res.ok) {
    // Return originals on failure
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
