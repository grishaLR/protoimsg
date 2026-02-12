import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';
import type { Redis } from '../redis/client.js';
import type { PresenceTrackerStore } from './tracker-store.js';

const USER_PREFIX = 'presence:user:';
const ROOM_PREFIX = 'presence:room:';
const ONLINE_SET = 'presence:online';

function userKey(did: string): string {
  return `${USER_PREFIX}${did}`;
}
function userRoomsKey(did: string): string {
  return `${USER_PREFIX}${did}:rooms`;
}
function roomKey(roomId: string): string {
  return `${ROOM_PREFIX}${roomId}`;
}

export class RedisPresenceTracker implements PresenceTrackerStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async setOnline(did: string): Promise<void> {
    const exists = await this.redis.exists(userKey(did));
    const pipeline = this.redis.pipeline();
    if (exists) {
      pipeline.hset(userKey(did), 'status', 'online', 'lastSeen', new Date().toISOString());
    } else {
      pipeline.hset(
        userKey(did),
        'status',
        'online',
        'visibleTo',
        'no-one',
        'lastSeen',
        new Date().toISOString(),
      );
    }
    pipeline.sadd(ONLINE_SET, did);
    await pipeline.exec();
  }

  async setOffline(did: string): Promise<void> {
    // Get all rooms first, then clean up everything in one pipeline
    const rooms = await this.redis.smembers(userRoomsKey(did));
    const pipeline = this.redis.pipeline();
    for (const roomId of rooms) {
      pipeline.srem(roomKey(roomId), did);
    }
    pipeline.del(userKey(did), userRoomsKey(did));
    pipeline.srem(ONLINE_SET, did);
    await pipeline.exec();
  }

  async setStatus(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): Promise<void> {
    const exists = await this.redis.exists(userKey(did));
    if (!exists) return;

    const fields: Record<string, string> = {
      status,
      lastSeen: new Date().toISOString(),
    };
    // Only store awayMessage for 'away' status
    fields.awayMessage = status === 'away' && awayMessage ? awayMessage : '';
    if (visibleTo) fields.visibleTo = visibleTo;

    await this.redis.hset(userKey(did), fields);
  }

  async joinRoom(did: string, roomId: string): Promise<void> {
    const exists = await this.redis.exists(userKey(did));
    if (!exists) return;

    const pipeline = this.redis.pipeline();
    pipeline.sadd(userRoomsKey(did), roomId);
    pipeline.sadd(roomKey(roomId), did);
    await pipeline.exec();
  }

  async leaveRoom(did: string, roomId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.srem(userRoomsKey(did), roomId);
    pipeline.srem(roomKey(roomId), did);
    await pipeline.exec();
  }

  async getStatus(did: string): Promise<PresenceStatus> {
    const status = await this.redis.hget(userKey(did), 'status');
    return status ? (status as PresenceStatus) : 'offline';
  }

  async getPresence(did: string): Promise<{ status: PresenceStatus; awayMessage?: string }> {
    const data = await this.redis.hmget(userKey(did), 'status', 'awayMessage');
    const status = data[0] ? (data[0] as PresenceStatus) : 'offline';
    const awayMessage = data[1] || undefined;
    return { status, awayMessage };
  }

  async getVisibleTo(did: string): Promise<PresenceVisibility> {
    const visibleTo = await this.redis.hget(userKey(did), 'visibleTo');
    return visibleTo ? (visibleTo as PresenceVisibility) : 'no-one';
  }

  async getPresenceBulk(
    dids: string[],
  ): Promise<Map<string, { status: PresenceStatus; awayMessage?: string }>> {
    const result = new Map<string, { status: PresenceStatus; awayMessage?: string }>();
    if (dids.length === 0) return result;

    const pipeline = this.redis.pipeline();
    for (const did of dids) {
      pipeline.hmget(userKey(did), 'status', 'awayMessage');
    }
    const responses = await pipeline.exec();

    for (let i = 0; i < dids.length; i++) {
      const did = dids[i];
      if (!did) continue;
      const [err, data] = responses?.[i] ?? [null, null];
      if (err || !data) {
        result.set(did, { status: 'offline' });
        continue;
      }
      const values = data as (string | null)[];
      const status = values[0] ? (values[0] as PresenceStatus) : 'offline';
      const awayMessage = values[1] || undefined;
      result.set(did, { status, awayMessage });
    }
    return result;
  }

  async getUserRooms(did: string): Promise<Set<string>> {
    const rooms = await this.redis.smembers(userRoomsKey(did));
    return new Set(rooms);
  }

  async getRoomMembers(roomId: string): Promise<string[]> {
    return this.redis.smembers(roomKey(roomId));
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.redis.smembers(ONLINE_SET);
  }
}
