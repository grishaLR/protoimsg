import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceTracker } from './tracker.js';
import { createPresenceService, type PresenceService } from './service.js';

describe('createPresenceService', () => {
  let tracker: PresenceTracker;
  let service: PresenceService;

  beforeEach(() => {
    tracker = new PresenceTracker();
    service = createPresenceService(tracker);
  });

  it('handleUserConnect sets user online', () => {
    service.handleUserConnect('did:plc:alice');
    expect(service.getUserStatus('did:plc:alice')).toBe('online');
  });

  it('handleUserDisconnect sets user offline', () => {
    service.handleUserConnect('did:plc:alice');
    service.handleUserDisconnect('did:plc:alice');
    expect(service.getUserStatus('did:plc:alice')).toBe('offline');
  });

  it('handleStatusChange updates status and away message', () => {
    service.handleUserConnect('did:plc:alice');
    service.handleStatusChange('did:plc:alice', 'away', 'lunch break', 'close-friends');
    const presence = service.getPresence('did:plc:alice');
    expect(presence.status).toBe('away');
    expect(presence.awayMessage).toBe('lunch break');
  });

  it('getBulkPresence returns array format', () => {
    service.handleUserConnect('did:plc:alice');
    service.handleStatusChange('did:plc:alice', 'away', 'afk');
    const result = service.getBulkPresence(['did:plc:alice', 'did:plc:unknown']);
    expect(result).toEqual([
      { did: 'did:plc:alice', status: 'away', awayMessage: 'afk' },
      { did: 'did:plc:unknown', status: 'offline', awayMessage: undefined },
    ]);
  });

  it('joinRoom and leaveRoom track room membership', () => {
    service.handleUserConnect('did:plc:alice');
    service.handleJoinRoom('did:plc:alice', 'room-1');
    expect(service.getRoomPresence('room-1')).toContain('did:plc:alice');

    service.handleLeaveRoom('did:plc:alice', 'room-1');
    expect(service.getRoomPresence('room-1')).not.toContain('did:plc:alice');
  });

  it('getUserRooms returns rooms the user has joined', () => {
    service.handleUserConnect('did:plc:alice');
    service.handleJoinRoom('did:plc:alice', 'room-1');
    service.handleJoinRoom('did:plc:alice', 'room-2');
    expect(service.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1', 'room-2']));
  });
});
