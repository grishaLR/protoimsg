import { USER_AGENT } from '@protoimsg/shared';
import type { RoomView, ChannelView, MessageView, PollView } from '../types';
import { API_URL, PDS_URL } from './config.js';

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

/** Throw the appropriate 403 error based on the server's errorCode. */
function throwForbiddenError(data: { error: string; errorCode?: string }): never {
  throw new AccountBannedError(data.error);
}

/** Pre-OAuth ban + captcha check — throws AccountBannedError, NotOnAllowlistError, or CaptchaFailedError. */
export async function preflightCheck(handle: string, turnstileToken?: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/preflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, turnstileToken }),
  });
  if (res.status === 403) {
    const data = (await res.json()) as { error: string; errorCode?: string };
    if (data.errorCode === 'CAPTCHA_FAILED') {
      throw new CaptchaFailedError(data.error || 'Verification failed');
    }
    throwForbiddenError(data);
  }
}

export async function fetchChallenge(did: string): Promise<ChallengeResponse> {
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
  if (res.status === 403) {
    const data = (await res.json()) as { error: string; errorCode?: string };
    throwForbiddenError(data);
  }
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

// -- PDS account creation --

export interface CreatePdsAccountResult {
  did: string;
  handle: string;
}

/** Check if a handle is available on the PDS. */
export async function checkHandleAvailability(
  handle: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await fetch(
    `${PDS_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    { signal },
  );
  // 400 = handle doesn't exist on this PDS = available
  if (res.status === 400) return true;
  // 200 = handle resolves = taken
  if (res.ok) return false;
  // Any other status (500, 429, etc.) = assume unavailable to be safe
  return false;
}

export class CaptchaFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptchaFailedError';
  }
}

/** Create an account via the protoimsg server (Turnstile-verified proxy to PDS). */
export async function createAccount(params: {
  handle: string;
  email: string;
  password: string;
  dob: string;
  turnstileToken?: string;
}): Promise<CreatePdsAccountResult> {
  const res = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      errorCode?: string;
      message?: string;
    };
    if (data.errorCode === 'CAPTCHA_FAILED') {
      throw new CaptchaFailedError(data.error || 'Verification failed');
    }
    const message = data.message ?? data.error ?? 'Account creation failed';
    throw new Error(message);
  }

  return (await res.json()) as CreatePdsAccountResult;
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
  // Best-effort: browsers silently ignore User-Agent on fetch (forbidden header)
  headers.set('User-Agent', USER_AGENT);
  const res = await fetch(`${API_URL}${url}`, { ...init, headers });
  if (res.status === 401 && serverToken) {
    // Session expired — clear token and reload to trigger re-auth
    setServerToken(null);
    window.location.reload();
  }
  return res;
}

// -- Rooms --

export async function fetchRooms(opts?: {
  visibility?: string;
  category?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<RoomView[]> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.category) params.set('category', opts.category);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));

  const qs = params.toString();
  const res = await authFetch(`/api/rooms${qs ? `?${qs}` : ''}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Failed to fetch rooms: ${res.status}`);

  const data = (await res.json()) as { rooms: RoomView[] };
  return data.rooms;
}

export async function fetchCategories(opts?: { signal?: AbortSignal }): Promise<string[]> {
  const res = await authFetch('/api/rooms/categories', { signal: opts?.signal });
  if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);

  const data = (await res.json()) as { categories: string[] };
  return data.categories;
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

// -- Channels --

export async function fetchChannels(
  roomId: string,
  opts?: { signal?: AbortSignal },
): Promise<ChannelView[]> {
  const res = await authFetch(`/api/rooms/${encodeURIComponent(roomId)}/channels`, {
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);

  const data = (await res.json()) as { channels: ChannelView[] };
  return data.channels;
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

// -- Channel-scoped messages --

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

// -- Channel-scoped polls --

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

// -- Polls --

export async function fetchPolls(
  roomId: string,
  opts?: { signal?: AbortSignal },
): Promise<PollView[]> {
  const res = await authFetch(`/api/rooms/${encodeURIComponent(roomId)}/polls`, {
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch polls: ${res.status}`);

  const data = (await res.json()) as { polls: PollView[] };
  return data.polls;
}

export async function fetchPoll(
  roomId: string,
  pollId: string,
  opts?: { signal?: AbortSignal },
): Promise<PollView> {
  const res = await authFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/polls/${encodeURIComponent(pollId)}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new Error(`Failed to fetch poll: ${res.status}`);

  const data = (await res.json()) as { poll: PollView };
  return data.poll;
}

// -- ICE servers --

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await authFetch('/api/ice-servers');
    if (!res.ok) throw new Error(`ICE server request failed: ${res.status}`);
    const data = (await res.json()) as {
      iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    };
    return data.iceServers;
  } catch {
    // No fallback to third-party STUN — prevents IP address leaks to Google
    return [];
  }
}

// -- GIF services --

export type GifSource = 'giphy' | 'klipy';

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
  previewWidth?: string;
  previewHeight?: string;
  source: GifSource;
}

export interface GifCapabilities {
  giphy: boolean;
  klipy: boolean;
}

export async function fetchGifCapabilities(): Promise<GifCapabilities> {
  try {
    const res = await fetch(`${API_URL}/api/gif/capabilities`);
    if (!res.ok) return { giphy: false, klipy: false };
    return (await res.json()) as GifCapabilities;
  } catch {
    return { giphy: false, klipy: false };
  }
}

export async function searchGifs(
  source: GifSource,
  query: string,
  opts?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<GifResult[]> {
  const params = new URLSearchParams({ q: query });

  if (source === 'klipy') {
    if (opts?.limit) params.set('per_page', String(opts.limit));
  } else {
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
  }

  const endpoint = source === 'klipy' ? '/api/gif/klipy-search' : '/api/gif/search';
  const res = await authFetch(`${endpoint}?${params.toString()}`, { signal: opts?.signal });
  if (!res.ok) return [];

  const data = (await res.json()) as { gifs: GifResult[] };
  return data.gifs;
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

// -- Feedback & Reports --

export async function sendFeedback(message: string): Promise<void> {
  const res = await authFetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Failed to send feedback');
  }
}

export async function sendReport(report: {
  subjectDid: string;
  category: string;
  description?: string;
  attachments?: string[];
}): Promise<void> {
  const res = await authFetch('/api/feedback/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Failed to submit report');
  }
}

export async function sendContentReport(report: {
  subjectUri: string;
  roomId?: string;
  category: string;
  description?: string;
  attachments?: string[];
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

export async function fetchTranslateStatus(): Promise<TranslateStatusResponse> {
  try {
    const res = await authFetch('/api/translate/status');
    if (!res.ok) return { available: false, languages: [] };
    return (await res.json()) as TranslateStatusResponse;
  } catch {
    return { available: false, languages: [] };
  }
}
