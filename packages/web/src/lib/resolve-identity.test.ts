import { describe, it, expect, vi } from 'vitest';
import { resolveDidOrHandle } from './resolve-identity.js';
// Mock publicAgent — resolve-identity now uses it instead of the passed agent
vi.mock('./public-agent.js', () => ({
  publicAgent: {
    resolveHandle: vi.fn(),
  },
}));

import { publicAgent } from './public-agent.js';

const mockResolveHandle = publicAgent.resolveHandle as ReturnType<typeof vi.fn>;

describe('resolveDidOrHandle', () => {
  it('returns DID as-is when input starts with did:', async () => {
    const result = await resolveDidOrHandle(null, 'did:plc:abc123');
    expect(result).toBe('did:plc:abc123');
    expect(mockResolveHandle).not.toHaveBeenCalled();
  });

  it('resolves a handle via publicAgent', async () => {
    mockResolveHandle.mockResolvedValue({ data: { did: 'did:plc:resolved' } });
    const result = await resolveDidOrHandle(null, 'alice.bsky.social');
    expect(result).toBe('did:plc:resolved');
    expect(mockResolveHandle).toHaveBeenCalledWith({ handle: 'alice.bsky.social' });
  });

  it('strips leading @ from handle', async () => {
    mockResolveHandle.mockResolvedValue({ data: { did: 'did:plc:resolved' } });
    const result = await resolveDidOrHandle(null, '@alice.bsky.social');
    expect(result).toBe('did:plc:resolved');
    expect(mockResolveHandle).toHaveBeenCalledWith({ handle: 'alice.bsky.social' });
  });

  it('trims whitespace', async () => {
    const result = await resolveDidOrHandle(null, '  did:plc:abc123  ');
    expect(result).toBe('did:plc:abc123');
  });

  it('rejects when publicAgent fails', async () => {
    mockResolveHandle.mockRejectedValue(new Error('Unable to resolve handle'));
    await expect(resolveDidOrHandle(null, 'nonexistent.handle')).rejects.toThrow(
      'Unable to resolve handle',
    );
  });
});
