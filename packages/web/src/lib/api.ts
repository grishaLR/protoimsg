import type { RoomView, MessageView } from '../types';

export async function fetchRooms(opts?: {
  visibility?: string;
  limit?: number;
  offset?: number;
}): Promise<RoomView[]> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));

  const qs = params.toString();
  const res = await fetch(`/api/rooms${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch rooms: ${res.status}`);

  const data = (await res.json()) as { rooms: RoomView[] };
  return data.rooms;
}

export async function fetchRoom(id: string): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 404) throw new NotFoundError('Room not found');
    throw new Error(`Failed to fetch room: ${res.status}`);
  }

  const data = (await res.json()) as { room: RoomView };
  return data.room;
}

export async function fetchMessages(
  roomId: string,
  opts?: { limit?: number; before?: string },
): Promise<MessageView[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);

  const qs = params.toString();
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);

  const data = (await res.json()) as { messages: MessageView[] };
  return data.messages;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
