import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidDid, verifyDidHandle } from './verify.js';

describe('isValidDid', () => {
  it('accepts did:plc', () => {
    expect(isValidDid('did:plc:abcdef123')).toBe(true);
  });

  it('accepts did:web', () => {
    expect(isValidDid('did:web:example.com')).toBe(true);
  });

  it('rejects missing prefix', () => {
    expect(isValidDid('plc:abcdef')).toBe(false);
  });

  it('accepts did:key (any DID method per DID Core)', () => {
    expect(isValidDid('did:key:z6Mk')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidDid('')).toBe(false);
  });
});

describe('verifyDidHandle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for matching DID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ did: 'did:plc:abc' }), { status: 200 }),
    );
    const result = await verifyDidHandle('did:plc:abc', 'alice.bsky.social', 'https://api.example');
    expect(result).toBe(true);
  });

  it('returns false for mismatched DID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ did: 'did:plc:other' }), { status: 200 }),
    );
    const result = await verifyDidHandle('did:plc:abc', 'alice.bsky.social', 'https://api.example');
    expect(result).toBe(false);
  });

  it('returns false for invalid DID without network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await verifyDidHandle('not-a-did', 'alice.bsky.social', 'https://api.example');
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await verifyDidHandle('did:plc:abc', 'alice.bsky.social', 'https://api.example');
    expect(result).toBe(false);
  });

  it('returns false on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
    const result = await verifyDidHandle('did:plc:abc', 'alice.bsky.social', 'https://api.example');
    expect(result).toBe(false);
  });

  it('encodes handle in URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ did: 'did:plc:abc' }), { status: 200 }));
    await verifyDidHandle('did:plc:abc', 'alice.bsky.social', 'https://api.example');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example/xrpc/com.atproto.identity.resolveHandle?handle=alice.bsky.social',
    );
  });
});
