import { describe, it, expect } from 'vitest';
import { computeConversationId, sortDids } from './queries.js';

describe('sortDids', () => {
  it('returns DIDs in lexicographic order', () => {
    expect(sortDids('did:plc:abc', 'did:plc:xyz')).toEqual(['did:plc:abc', 'did:plc:xyz']);
  });

  it('swaps when first DID is larger', () => {
    expect(sortDids('did:plc:xyz', 'did:plc:abc')).toEqual(['did:plc:abc', 'did:plc:xyz']);
  });

  it('handles equal DIDs', () => {
    expect(sortDids('did:plc:same', 'did:plc:same')).toEqual(['did:plc:same', 'did:plc:same']);
  });
});

describe('computeConversationId', () => {
  it('returns a 16 character hex string', () => {
    const id = computeConversationId('did:plc:alice', 'did:plc:bob');
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic — same inputs produce same output', () => {
    const id1 = computeConversationId('did:plc:alice', 'did:plc:bob');
    const id2 = computeConversationId('did:plc:alice', 'did:plc:bob');
    expect(id1).toBe(id2);
  });

  it('is symmetric — order of DIDs does not matter', () => {
    const id1 = computeConversationId('did:plc:alice', 'did:plc:bob');
    const id2 = computeConversationId('did:plc:bob', 'did:plc:alice');
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different pairs', () => {
    const id1 = computeConversationId('did:plc:alice', 'did:plc:bob');
    const id2 = computeConversationId('did:plc:alice', 'did:plc:carol');
    expect(id1).not.toBe(id2);
  });
});
