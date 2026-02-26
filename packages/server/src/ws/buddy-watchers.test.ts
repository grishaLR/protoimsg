/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunityWatchers } from './buddy-watchers.js';
import type { WebSocket } from 'ws';

vi.mock('../community/queries.js', () => ({
  batchIsCommunityMember: vi.fn(),
  batchIsInnerCircleMember: vi.fn(),
}));

const { batchIsCommunityMember, batchIsInnerCircleMember } =
  await import('../community/queries.js');

function createMockWs(): WebSocket {
  const ws = {
    send: vi.fn(),
    readyState: 1, // OPEN
    OPEN: 1,
  };
  return ws as unknown as WebSocket;
}

function parseSentMessage(ws: WebSocket): {
  type: string;
  data: Array<{ did: string; status: string; awayMessage?: string }>;
} {
  const sendMock = vi.mocked(ws.send);
  expect(sendMock).toHaveBeenCalled();
  const raw = sendMock.mock.lastCall?.[0];
  expect(raw).toBeDefined();
  return JSON.parse(raw as string) as {
    type: string;
    data: Array<{ did: string; status: string; awayMessage?: string }>;
  };
}

const mockSql = {} as never;
const mockIsBlocked = vi.fn().mockReturnValue(false);
const mockBlockService = {
  isBlocked: mockIsBlocked,
} as never;

describe('CommunityWatchers', () => {
  let watchers: CommunityWatchers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBlocked.mockReturnValue(false);
    watchers = new CommunityWatchers(mockSql, mockBlockService);
  });

  it('watch registers a socket to receive updates for DIDs', async () => {
    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'everyone');
    const payload = parseSentMessage(ws);
    expect(payload.type).toBe('community_presence');
    expect(payload.data[0]?.status).toBe('online');
  });

  it('does not notify for unwatched DIDs', async () => {
    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:bob', 'online');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('unwatchAll removes socket from all watch lists', async () => {
    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice', 'did:plc:bob']);
    watchers.unwatchAll(ws);
    await watchers.notify('did:plc:alice', 'online');
    await watchers.notify('did:plc:bob', 'online');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('skips closed sockets', async () => {
    const ws = createMockWs();
    (ws as unknown as { readyState: number }).readyState = 3; // CLOSED
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('broadcasts to multiple watchers with everyone visibility', async () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    watchers.watch(ws1, 'did:plc:w1', ['did:plc:alice']);
    watchers.watch(ws2, 'did:plc:w2', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'away', 'brb');
    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();
  });

  it('includes awayMessage in notification', async () => {
    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'away', 'lunch', 'everyone');
    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.awayMessage).toBe('lunch');
  });

  it('resolves inner-circle visibility per watcher', async () => {
    vi.mocked(batchIsCommunityMember).mockResolvedValue(new Set(['did:plc:friend']));
    vi.mocked(batchIsInnerCircleMember).mockResolvedValue(new Set(['did:plc:friend']));

    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:friend', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'inner-circle');

    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.status).toBe('online');
  });

  it('shows offline for non-friends with inner-circle visibility', async () => {
    vi.mocked(batchIsCommunityMember).mockResolvedValue(new Set(['did:plc:stranger']));
    vi.mocked(batchIsInnerCircleMember).mockResolvedValue(new Set());

    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:stranger', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'inner-circle');

    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.status).toBe('offline');
  });

  it('shows offline to blocked watchers (everyone visibility)', async () => {
    mockIsBlocked.mockReturnValue(true);

    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:blocked', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'everyone');

    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.status).toBe('offline');
  });

  it('shows offline to blocked watchers (community visibility)', async () => {
    mockIsBlocked.mockReturnValue(true);

    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:blocked', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'community');

    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.status).toBe('offline');
    // Batch queries called with empty array — blocked watchers are excluded
    expect(batchIsCommunityMember).toHaveBeenCalledWith(mockSql, 'did:plc:alice', []);
  });

  it('resolves community visibility — member sees online, non-member sees offline', async () => {
    vi.mocked(batchIsCommunityMember).mockResolvedValue(new Set(['did:plc:member']));

    const wsMember = createMockWs();
    const wsStranger = createMockWs();
    watchers.watch(wsMember, 'did:plc:member', ['did:plc:alice']);
    watchers.watch(wsStranger, 'did:plc:stranger', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'community');

    const memberPayload = parseSentMessage(wsMember);
    expect(memberPayload.data[0]?.status).toBe('online');

    const strangerPayload = parseSentMessage(wsStranger);
    expect(strangerPayload.data[0]?.status).toBe('offline');
  });

  it('shows offline to everyone with no-one visibility', async () => {
    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'no-one');

    const payload = parseSentMessage(ws);
    expect(payload.data[0]?.status).toBe('offline');
    // No batch queries needed for no-one visibility
    expect(batchIsCommunityMember).not.toHaveBeenCalled();
    expect(batchIsInnerCircleMember).not.toHaveBeenCalled();
  });

  it('calls batch functions with correct arguments', async () => {
    vi.mocked(batchIsCommunityMember).mockResolvedValue(new Set());
    vi.mocked(batchIsInnerCircleMember).mockResolvedValue(new Set());

    const ws = createMockWs();
    watchers.watch(ws, 'did:plc:watcher', ['did:plc:alice']);
    await watchers.notify('did:plc:alice', 'online', undefined, 'inner-circle');

    // ownerDid is the target, queryDids are the watchers
    expect(batchIsCommunityMember).toHaveBeenCalledWith(mockSql, 'did:plc:alice', [
      'did:plc:watcher',
    ]);
    expect(batchIsInnerCircleMember).toHaveBeenCalledWith(mockSql, 'did:plc:alice', [
      'did:plc:watcher',
    ]);
  });
});
