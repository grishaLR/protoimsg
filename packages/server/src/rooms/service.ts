import type { Sql } from '../db/client.js';
import { listRooms, getRoomById, type RoomRow } from './queries.js';

export interface RoomListOptions {
  visibility?: string;
  limit?: number;
  offset?: number;
}

export async function getRooms(sql: Sql, options: RoomListOptions = {}): Promise<RoomRow[]> {
  return listRooms(sql, options);
}

export async function getRoom(sql: Sql, id: string): Promise<RoomRow | undefined> {
  return getRoomById(sql, id);
}
