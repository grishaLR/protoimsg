import { describe, it, expect, vi } from 'vitest';
import { resolveDidOrHandle } from './resolve-identity.js';
import type { Agent } from '@atproto/api';

function createMockAgent(did = 'did:plc:resolved'): Agent {
  return {
    resolveHandle: vi.fn().mockResolvedValue({ data: { did } }),
  } as unknown as Agent;
}

describe('resolveDidOrHandle', () => {
  it('returns DID as-is when input starts with did:', async () => {
    const agent = createMockAgent();
    const result = await resolveDidOrHandle(agent, 'did:plc:abc123');
    expect(result).toBe('did:plc:abc123');
    expect(agent.resolveHandle).not.toHaveBeenCalled();
  });

  it('resolves a handle via the agent', async () => {
    const agent = createMockAgent('did:plc:resolved');
    const result = await resolveDidOrHandle(agent, 'alice.bsky.social');
    expect(result).toBe('did:plc:resolved');
    expect(agent.resolveHandle).toHaveBeenCalledWith({ handle: 'alice.bsky.social' });
  });

  it('strips leading @ from handle', async () => {
    const agent = createMockAgent('did:plc:resolved');
    const result = await resolveDidOrHandle(agent, '@alice.bsky.social');
    expect(result).toBe('did:plc:resolved');
    expect(agent.resolveHandle).toHaveBeenCalledWith({ handle: 'alice.bsky.social' });
  });

  it('trims whitespace', async () => {
    const agent = createMockAgent();
    const result = await resolveDidOrHandle(agent, '  did:plc:abc123  ');
    expect(result).toBe('did:plc:abc123');
  });

  it('rejects when agent fails', async () => {
    const agent = {
      resolveHandle: vi.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as Agent;
    await expect(resolveDidOrHandle(agent, 'nonexistent.handle')).rejects.toThrow('Not found');
  });
});
