import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

export const storage = new MMKV({ id: 'protoimsg' });

const KEYCHAIN_KEY = 'protoimsg-mmkv-encryption-key';
const LEGACY_ENCRYPTION_KEY = 'protoimsg-keychain-bridge';

/**
 * Retrieve or generate a random encryption key stored in the OS keychain
 * (iOS Keychain / Android Keystore). Falls back to a static key if
 * SecureStore is unavailable (e.g. Expo Go).
 */
function getOrCreateEncryptionKey(): string {
  try {
    const existing = SecureStore.getItem(KEYCHAIN_KEY);
    if (existing) return existing;

    // Generate 32 random bytes as hex string
    const bytes = new Uint8Array(32);
    // crypto.getRandomValues is available in Hermes with RN 0.76+
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    SecureStore.setItem(KEYCHAIN_KEY, key);
    return key;
  } catch {
    // SecureStore unavailable (Expo Go, test environment) — fall back
    return LEGACY_ENCRYPTION_KEY;
  }
}

const encryptionKey = getOrCreateEncryptionKey();

/**
 * Migrate data from the old hardcoded-key MMKV instance to the new one.
 * Only runs once — when the encryption key has changed from the legacy value.
 */
function createSecureStorage(): MMKV {
  const newStore = new MMKV({ id: 'protoimsg-secure', encryptionKey });

  if (encryptionKey !== LEGACY_ENCRYPTION_KEY) {
    // Check if we need to migrate from the old key
    try {
      const legacyStore = new MMKV({
        id: 'protoimsg-secure',
        encryptionKey: LEGACY_ENCRYPTION_KEY,
      });
      const allKeys = legacyStore.getAllKeys();
      if (allKeys.length > 0) {
        for (const key of allKeys) {
          const value = legacyStore.getString(key);
          if (value !== undefined) newStore.set(key, value);
        }
        legacyStore.clearAll();
      }
    } catch {
      // Legacy store unreadable or already migrated — ignore
    }
  }

  return newStore;
}

/** Separate MMKV instance with encryption for sensitive values (tokens). */
const secureStorage = createSecureStorage();

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
