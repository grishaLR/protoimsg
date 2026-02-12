import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPresenceTracker } from './tracker.js';

describe('InMemoryPresenceTracker', () => {
  let tracker: InMemoryPresenceTracker;

  beforeEach(() => {
    tracker = new InMemoryPresenceTracker();
  });

  it('sets a user online', async () => {
    await tracker.setOnline('did:plc:alice');
    expect(await tracker.getStatus('did:plc:alice')).toBe('online');
  });

  it('sets a user offline by removing them', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setOffline('did:plc:alice');
    expect(await tracker.getStatus('did:plc:alice')).toBe('offline');
  });

  it('returns offline for unknown users', async () => {
    expect(await tracker.getStatus('did:plc:unknown')).toBe('offline');
  });

  it('sets status with away message', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setStatus('did:plc:alice', 'away', 'brb lunch');
    const presence = await tracker.getPresence('did:plc:alice');
    expect(presence.status).toBe('away');
    expect(presence.awayMessage).toBe('brb lunch');
  });

  it('clears away message when going back online', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setStatus('did:plc:alice', 'away', 'brb');
    await tracker.setStatus('did:plc:alice', 'online');
    const presence = await tracker.getPresence('did:plc:alice');
    expect(presence.status).toBe('online');
    expect(presence.awayMessage).toBeUndefined();
  });

  it('sets visibleTo', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setStatus('did:plc:alice', 'online', undefined, 'inner-circle');
    expect(await tracker.getVisibleTo('did:plc:alice')).toBe('inner-circle');
  });

  it('defaults visibleTo to no-one', async () => {
    await tracker.setOnline('did:plc:alice');
    expect(await tracker.getVisibleTo('did:plc:alice')).toBe('no-one');
  });

  it('returns no-one for unknown user visibleTo', async () => {
    expect(await tracker.getVisibleTo('did:plc:unknown')).toBe('no-one');
  });

  it('getPresence returns offline for unknown users', async () => {
    const presence = await tracker.getPresence('did:plc:unknown');
    expect(presence.status).toBe('offline');
    expect(presence.awayMessage).toBeUndefined();
  });

  it('getPresenceBulk returns statuses for multiple users', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setOnline('did:plc:bob');
    await tracker.setStatus('did:plc:bob', 'away', 'afk');

    const bulk = await tracker.getPresenceBulk(['did:plc:alice', 'did:plc:bob', 'did:plc:unknown']);
    expect(bulk.get('did:plc:alice')).toEqual({ status: 'online', awayMessage: undefined });
    expect(bulk.get('did:plc:bob')).toEqual({ status: 'away', awayMessage: 'afk' });
    expect(bulk.get('did:plc:unknown')).toEqual({ status: 'offline', awayMessage: undefined });
  });

  it('tracks room membership', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.joinRoom('did:plc:alice', 'room-1');
    await tracker.joinRoom('did:plc:alice', 'room-2');
    expect(await tracker.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1', 'room-2']));
  });

  it('leaves a room', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.joinRoom('did:plc:alice', 'room-1');
    await tracker.leaveRoom('did:plc:alice', 'room-1');
    expect((await tracker.getUserRooms('did:plc:alice')).size).toBe(0);
  });

  it('getRoomMembers returns all users in a room', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setOnline('did:plc:bob');
    await tracker.joinRoom('did:plc:alice', 'room-1');
    await tracker.joinRoom('did:plc:bob', 'room-1');
    const members = await tracker.getRoomMembers('room-1');
    expect(members).toContain('did:plc:alice');
    expect(members).toContain('did:plc:bob');
    expect(members).toHaveLength(2);
  });

  it('getOnlineUsers returns all online DIDs', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setOnline('did:plc:bob');
    const online = await tracker.getOnlineUsers();
    expect(online).toContain('did:plc:alice');
    expect(online).toContain('did:plc:bob');
    expect(online).toHaveLength(2);
  });

  it('returns empty set for unknown user rooms', async () => {
    expect(await tracker.getUserRooms('did:plc:unknown')).toEqual(new Set());
  });

  it('re-setting online preserves existing user', async () => {
    await tracker.setOnline('did:plc:alice');
    await tracker.setStatus('did:plc:alice', 'away', 'brb');
    await tracker.joinRoom('did:plc:alice', 'room-1');
    await tracker.setOnline('did:plc:alice');
    // Status resets to online but rooms persist
    expect(await tracker.getStatus('did:plc:alice')).toBe('online');
    expect(await tracker.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1']));
  });
});
