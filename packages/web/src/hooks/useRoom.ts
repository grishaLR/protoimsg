import { useCallback, useEffect, useState } from 'react';
import { fetchRoom, NotFoundError } from '../lib/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { RoomView } from '../types';
import type { ServerMessage } from '@chatmosphere/shared';

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { send, subscribe } = useWebSocket();

  // Fetch room details with retry for newly created rooms
  const loadRoom = useCallback(async () => {
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        const data = await fetchRoom(roomId);
        setRoom(data);
        setError(null);
        setLoading(false);
        return;
      } catch (err) {
        if (err instanceof NotFoundError && retries < maxRetries - 1) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        setError(err instanceof Error ? err.message : 'Failed to load room');
        setLoading(false);
        return;
      }
    }
  }, [roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  // Join room via WS and listen for member updates
  useEffect(() => {
    if (!room) return;

    send({ type: 'join_room', roomId });

    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'room_joined') {
        if (msg.roomId === roomId) {
          setMembers(msg.members);
        }
      } else if (msg.type === 'presence') {
        setMembers((prev) => {
          if (msg.data.status === 'offline') {
            return prev.filter((d) => d !== msg.data.did);
          }
          if (!prev.includes(msg.data.did)) {
            return [...prev, msg.data.did];
          }
          return prev;
        });
      }
    });

    return () => {
      send({ type: 'leave_room', roomId });
      unsub();
    };
  }, [room, roomId, send, subscribe]);

  return { room, members, loading, error };
}
