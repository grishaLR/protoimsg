import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRoom, NotFoundError } from '../lib/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { playDoorOpen, playDoorClose } from '../lib/sounds';
import type { RoomView, MemberPresence } from '../types';
import type { ServerMessage } from '@protoimsg/shared';

export type DoorEvent = 'join' | 'leave';

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [members, setMembers] = useState<MemberPresence[]>([]);
  const [doorEvents, setDoorEvents] = useState<Record<string, DoorEvent>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { send, subscribe } = useWebSocket();
  const knownDidsRef = useRef<Set<string>>(new Set());

  // Fetch room details with retry for newly created rooms
  const loadRoom = useCallback(
    async (signal?: AbortSignal) => {
      let retries = 0;
      const maxRetries = 5;

      while (retries < maxRetries) {
        try {
          const data = await fetchRoom(roomId, { signal });
          if (signal?.aborted) return;
          setRoom(data);
          setError(null);
          setLoading(false);
          return;
        } catch (err) {
          if (signal?.aborted) return;
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
    },
    [roomId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void loadRoom(ac.signal);
    return () => {
      ac.abort();
    };
  }, [loadRoom]);

  // Join room via WS and listen for member updates
  useEffect(() => {
    if (!room) return;

    send({ type: 'join_room', roomId });

    const timers = new Set<ReturnType<typeof setTimeout>>();

    const addDoorEvent = (did: string, event: DoorEvent) => {
      setDoorEvents((prev) => ({ ...prev, [did]: event }));
      const t = setTimeout(() => {
        timers.delete(t);
        setDoorEvents((prev) => {
          const { [did]: _, ...rest } = prev;
          return rest;
        });
        if (event === 'leave') {
          setMembers((prev) => prev.filter((m) => m.did !== did));
        }
      }, 5000);
      timers.add(t);
    };

    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'room_joined') {
        if (msg.roomId === roomId) {
          knownDidsRef.current = new Set(msg.members);
          setMembers(msg.members.map((did) => ({ did, status: 'online' })));
        }
      } else if (msg.type === 'presence') {
        const { did, status: s, awayMessage: away } = msg.data;

        if (s === 'offline') {
          if (knownDidsRef.current.has(did)) {
            knownDidsRef.current.delete(did);
            playDoorClose();
            setMembers((prev) =>
              prev.map((m) => (m.did === did ? { ...m, status: 'offline' } : m)),
            );
            addDoorEvent(did, 'leave');
          }
        } else if (!knownDidsRef.current.has(did)) {
          knownDidsRef.current.add(did);
          playDoorOpen();
          setMembers((prev) => [...prev, { did, status: s, awayMessage: away }]);
          addDoorEvent(did, 'join');
        } else {
          setMembers((prev) =>
            prev.map((m) => (m.did === did ? { ...m, status: s, awayMessage: away } : m)),
          );
        }
      }
    });

    return () => {
      send({ type: 'leave_room', roomId });
      for (const t of timers) clearTimeout(t);
      timers.clear();
      knownDidsRef.current.clear();
      unsub();
    };
  }, [room, roomId, send, subscribe]);

  return { room, members, doorEvents, loading, error };
}
