import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRoom, NotFoundError } from '../lib/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { playDoorOpen, playDoorClose } from '../lib/sounds';
import type { RoomView, ChannelView, MemberPresence } from '../types';
import type { ServerMessage, ChannelInfo, RoomRoleInfo } from '@protoimsg/shared';

export type DoorEvent = 'join' | 'leave';

function channelInfoToView(info: ChannelInfo): ChannelView {
  return {
    id: info.id,
    uri: info.uri,
    did: info.did,
    roomId: info.roomId,
    name: info.name,
    description: info.description,
    position: info.position,
    postPolicy: info.postPolicy,
    isDefault: info.isDefault,
    createdAt: info.createdAt,
  };
}

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [members, setMembers] = useState<MemberPresence[]>([]);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [roles, setRoles] = useState<RoomRoleInfo[]>([]);
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
          setChannels(msg.channels.map(channelInfoToView));
          setRoles(Array.isArray(msg.roles) ? msg.roles : []);
        }
      } else if (msg.type === 'channel_created') {
        if (msg.data.roomId === roomId) {
          setChannels((prev) => {
            const updated = [...prev, channelInfoToView(msg.data)];
            return updated.sort((a, b) => a.position - b.position);
          });
        }
      } else if (msg.type === 'channel_deleted') {
        if (msg.data.roomId === roomId) {
          setChannels((prev) => prev.filter((ch) => ch.id !== msg.data.channelId));
        }
      } else if (msg.type === 'room_ban') {
        if (msg.data.roomId === roomId) {
          if (msg.data.action === 'ban') {
            // Remove banned user from member list
            setMembers((prev) => prev.filter((m) => m.did !== msg.data.subjectDid));
            knownDidsRef.current.delete(msg.data.subjectDid);
          }
        }
      } else if (msg.type === 'room_role_update') {
        if (msg.data.roomId === roomId) {
          if (msg.data.action === 'add') {
            setRoles((prev) => {
              // Replace existing role for this user or add new
              const filtered = prev.filter((r) => r.did !== msg.data.subjectDid);
              return [...filtered, { did: msg.data.subjectDid, role: msg.data.role }];
            });
          } else {
            setRoles((prev) => prev.filter((r) => r.did !== msg.data.subjectDid));
          }
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

  return { room, members, channels, roles, doorEvents, loading, error };
}
