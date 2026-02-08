/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DmSubscriptions } from './subscriptions.js';
import type { WebSocket } from 'ws';

function createMockWs(): WebSocket {
  return {
    send: vi.fn(),
    readyState: 1, // OPEN
    OPEN: 1,
  } as unknown as WebSocket;
}

describe('DmSubscriptions', () => {
  let subs: DmSubscriptions;

  beforeEach(() => {
    subs = new DmSubscriptions();
  });

  it('subscribes and reports hasSubscribers', () => {
    const ws = createMockWs();
    subs.subscribe('conv1', ws);
    expect(subs.hasSubscribers('conv1')).toBe(true);
  });

  it('reports no subscribers for unknown conversation', () => {
    expect(subs.hasSubscribers('unknown')).toBe(false);
  });

  it('unsubscribes and cleans up empty sets', () => {
    const ws = createMockWs();
    subs.subscribe('conv1', ws);
    subs.unsubscribe('conv1', ws);
    expect(subs.hasSubscribers('conv1')).toBe(false);
  });

  it('unsubscribeAll returns abandoned conversation IDs', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    subs.subscribe('conv1', ws1);
    subs.subscribe('conv2', ws1);
    subs.subscribe('conv2', ws2); // ws2 also in conv2

    const abandoned = subs.unsubscribeAll(ws1);

    // conv1 had only ws1, so it's abandoned
    expect(abandoned.has('conv1')).toBe(true);
    // conv2 still has ws2, so it's not abandoned
    expect(abandoned.has('conv2')).toBe(false);
    expect(subs.hasSubscribers('conv2')).toBe(true);
  });

  it('broadcast sends to all subscribers', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    subs.subscribe('conv1', ws1);
    subs.subscribe('conv1', ws2);

    subs.broadcast('conv1', { type: 'test' });

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
  });

  it('broadcast excludes specified socket', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    subs.subscribe('conv1', ws1);
    subs.subscribe('conv1', ws2);

    subs.broadcast('conv1', { type: 'test' }, ws1);

    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
  });

  it('broadcast skips closed sockets', () => {
    const ws = createMockWs();
    (ws as unknown as { readyState: number }).readyState = 3; // CLOSED
    subs.subscribe('conv1', ws);

    subs.broadcast('conv1', { type: 'test' });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('getSubscribers returns empty set for unknown conversation', () => {
    const subscribers = subs.getSubscribers('unknown');
    expect(subscribers.size).toBe(0);
  });
});
