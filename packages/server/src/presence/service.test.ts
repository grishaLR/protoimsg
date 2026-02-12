import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPresenceTracker } from './tracker.js';
import { createPresenceService, type PresenceService } from './service.js';

describe('createPresenceService', () => {
  let tracker: InMemoryPresenceTracker;
  let service: PresenceService;

  beforeEach(() => {
    tracker = new InMemoryPresenceTracker();
    service = createPresenceService(tracker);
  });

  it('handleUserConnect sets user online', async () => {
    await service.handleUserConnect('did:plc:alice');
    expect(await service.getUserStatus('did:plc:alice')).toBe('online');
  });

  it('handleUserDisconnect sets user offline', async () => {
    await service.handleUserConnect('did:plc:alice');
    await service.handleUserDisconnect('did:plc:alice');
    expect(await service.getUserStatus('did:plc:alice')).toBe('offline');
  });

  it('handleStatusChange updates status and away message', async () => {
    await service.handleUserConnect('did:plc:alice');
    await service.handleStatusChange('did:plc:alice', 'away', 'lunch break', 'inner-circle');
    const presence = await service.getPresence('did:plc:alice');
    expect(presence.status).toBe('away');
    expect(presence.awayMessage).toBe('lunch break');
  });

  it('getBulkPresence returns array format', async () => {
    await service.handleUserConnect('did:plc:alice');
    await service.handleStatusChange('did:plc:alice', 'away', 'afk');
    const result = await service.getBulkPresence(['did:plc:alice', 'did:plc:unknown']);
    expect(result).toEqual([
      { did: 'did:plc:alice', status: 'away', awayMessage: 'afk' },
      { did: 'did:plc:unknown', status: 'offline', awayMessage: undefined },
    ]);
  });

  it('joinRoom and leaveRoom track room membership', async () => {
    await service.handleUserConnect('did:plc:alice');
    await service.handleJoinRoom('did:plc:alice', 'room-1');
    expect(await service.getRoomPresence('room-1')).toContain('did:plc:alice');

    await service.handleLeaveRoom('did:plc:alice', 'room-1');
    expect(await service.getRoomPresence('room-1')).not.toContain('did:plc:alice');
  });

  it('getUserRooms returns rooms the user has joined', async () => {
    await service.handleUserConnect('did:plc:alice');
    await service.handleJoinRoom('did:plc:alice', 'room-1');
    await service.handleJoinRoom('did:plc:alice', 'room-2');
    expect(await service.getUserRooms('did:plc:alice')).toEqual(new Set(['room-1', 'room-2']));
  });
});
