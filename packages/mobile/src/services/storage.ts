import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'protoimsg' });

/** Separate MMKV instance with encryption for sensitive values (tokens). */
const secureStorage = new MMKV({
  id: 'protoimsg-secure',
  encryptionKey: 'protoimsg-keychain-bridge',
});

const KEYS = {
  serverToken: 'protoimsg:server_token',
  did: 'protoimsg:did',
  handle: 'protoimsg:handle',
  visibleTo: 'protoimsg:visibleTo',
  theme: 'protoimsg:theme',
  soundEnabled: 'protoimsg:soundEnabled',
} as const;

const SECURE_KEY_TOKEN = 'token';

// -- Secure token storage (encrypted MMKV) --

export function getStoredToken(): string | null {
  // Migration: move token from plaintext MMKV to encrypted instance on first read
  const secureToken = secureStorage.getString(SECURE_KEY_TOKEN);
  if (secureToken) return secureToken;

  const mmkvToken = storage.getString(KEYS.serverToken);
  if (mmkvToken) {
    secureStorage.set(SECURE_KEY_TOKEN, mmkvToken);
    storage.delete(KEYS.serverToken);
    return mmkvToken;
  }

  return null;
}

export function setStoredToken(token: string | null): void {
  if (token) {
    secureStorage.set(SECURE_KEY_TOKEN, token);
  } else {
    secureStorage.delete(SECURE_KEY_TOKEN);
  }
  // Always clean plaintext MMKV in case of leftover
  storage.delete(KEYS.serverToken);
}

// -- Non-sensitive MMKV storage --

export function getStoredDid(): string | null {
  return storage.getString(KEYS.did) ?? null;
}

export function setStoredDid(did: string | null): void {
  if (did) {
    storage.set(KEYS.did, did);
  } else {
    storage.delete(KEYS.did);
  }
}

export function getStoredHandle(): string | null {
  return storage.getString(KEYS.handle) ?? null;
}

export function setStoredHandle(handle: string | null): void {
  if (handle) {
    storage.set(KEYS.handle, handle);
  } else {
    storage.delete(KEYS.handle);
  }
}

export function getStoredVisibility(): string | null {
  return storage.getString(KEYS.visibleTo) ?? null;
}

export function setStoredVisibility(value: string | null): void {
  if (value) {
    storage.set(KEYS.visibleTo, value);
  } else {
    storage.delete(KEYS.visibleTo);
  }
}

export function clearAllAuth(): void {
  secureStorage.delete(SECURE_KEY_TOKEN);
  storage.delete(KEYS.serverToken);
  storage.delete(KEYS.did);
  storage.delete(KEYS.handle);
}
