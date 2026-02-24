import type { Sql } from '../db/client.js';
import { listRooms, listCategories, getRoomById, type RoomRow } from './queries.js';

export interface RoomListOptions {
  visibility?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export async function getRooms(sql: Sql, options: RoomListOptions = {}): Promise<RoomRow[]> {
  return listRooms(sql, options);
}

export async function getCategories(sql: Sql): Promise<string[]> {
  return listCategories(sql);
}

export async function getRoom(sql: Sql, id: string): Promise<RoomRow | undefined> {
  return getRoomById(sql, id);
}
