import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceTracker } from './tracker.js';

describe('PresenceTracker', () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    tracker = new PresenceTracker();
  });

  it('sets a user online', () => {
    tracker.setOnline('did:plc:alice');
    expect(tracker.getStatus('did:plc:alice')).toBe('online');
  });

  it('sets a user offline by removing them', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setOffline('did:plc:alice');
    expect(tracker.getStatus('did:plc:alice')).toBe('offline');
  });

  it('returns offline for unknown users', () => {
    expect(tracker.getStatus('did:plc:unknown')).toBe('offline');
  });

  it('sets status with away message', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setStatus('did:plc:alice', 'away', 'brb lunch');
    const presence = tracker.getPresence('did:plc:alice');
    expect(presence.status).toBe('away');
    expect(presence.awayMessage).toBe('brb lunch');
  });

  it('clears away message when going back online', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setStatus('did:plc:alice', 'away', 'brb');
    tracker.setStatus('did:plc:alice', 'online');
    const presence = tracker.getPresence('did:plc:alice');
    expect(presence.status).toBe('online');
    expect(presence.awayMessage).toBeUndefined();
  });

  it('sets visibleTo', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setStatus('did:plc:alice', 'online', undefined, 'close-friends');
    expect(tracker.getVisibleTo('did:plc:alice')).toBe('close-friends');
  });

  it('defaults visibleTo to everyone', () => {
    tracker.setOnline('did:plc:alice');
    expect(tracker.getVisibleTo('did:plc:alice')).toBe('everyone');
  });

  it('returns everyone for unknown user visibleTo', () => {
    expect(tracker.getVisibleTo('did:plc:unknown')).toBe('everyone');
  });

  it('getPresence returns offline for unknown users', () => {
    const presence = tracker.getPresence('did:plc:unknown');
    expect(presence.status).toBe('offline');
    expect(presence.awayMessage).toBeUndefined();
  });

  it('getPresenceBulk returns statuses for multiple users', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setOnline('did:plc:bob');
    tracker.setStatus('did:plc:bob', 'away', 'afk');

    const bulk = tracker.getPresenceBulk(['did:plc:alice', 'did:plc:bob', 'did:plc:unknown']);
    expect(bulk.get('did:plc:alice')).toEqual({ status: 'online', awayMessage: undefined });
    expect(bulk.get('did:plc:bob')).toEqual({ status: 'away', awayMessage: 'afk' });
    expect(bulk.get('did:plc:unknown')).toEqual({ status: 'offline', awayMessage: undefined });
  });

  it('tracks room membership', () => {
    tracker.setOnline('did:plc:alice');
    tracker.joinRoom('did:plc:alice', 'room-1');
    tracker.joinRoom('did:plc:alice', 'room-2');
    expect(tracker.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1', 'room-2']));
  });

  it('leaves a room', () => {
    tracker.setOnline('did:plc:alice');
    tracker.joinRoom('did:plc:alice', 'room-1');
    tracker.leaveRoom('did:plc:alice', 'room-1');
    expect(tracker.getUserRooms('did:plc:alice').size).toBe(0);
  });

  it('getRoomMembers returns all users in a room', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setOnline('did:plc:bob');
    tracker.joinRoom('did:plc:alice', 'room-1');
    tracker.joinRoom('did:plc:bob', 'room-1');
    const members = tracker.getRoomMembers('room-1');
    expect(members).toContain('did:plc:alice');
    expect(members).toContain('did:plc:bob');
    expect(members).toHaveLength(2);
  });

  it('getOnlineUsers returns all online DIDs', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setOnline('did:plc:bob');
    const online = tracker.getOnlineUsers();
    expect(online).toContain('did:plc:alice');
    expect(online).toContain('did:plc:bob');
    expect(online).toHaveLength(2);
  });

  it('returns empty set for unknown user rooms', () => {
    expect(tracker.getUserRooms('did:plc:unknown')).toEqual(new Set());
  });

  it('re-setting online preserves existing user', () => {
    tracker.setOnline('did:plc:alice');
    tracker.setStatus('did:plc:alice', 'away', 'brb');
    tracker.joinRoom('did:plc:alice', 'room-1');
    tracker.setOnline('did:plc:alice');
    // Status resets to online but rooms persist
    expect(tracker.getStatus('did:plc:alice')).toBe('online');
    expect(tracker.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1']));
  });
});
