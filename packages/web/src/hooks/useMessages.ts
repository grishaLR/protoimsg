import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMessages } from '../lib/api';
import { createMessageRecord, type CreateMessageInput } from '../lib/atproto';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from './useAuth';
import type { MessageView } from '../types';

const MAX_MESSAGES = 500;

export function useMessages(roomId: string) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const { send, subscribe } = useWebSocket();
  const { agent, did } = useAuth();
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSent = useRef(0);

  // Load message history
  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      try {
        const data = await fetchMessages(roomId, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setMessages(data.reverse());
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load messages:', err);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => {
      ac.abort();
    };
  }, [roomId]);

  // Listen for real-time messages + typing via WS
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'message') {
        const event = msg;
        if (event.data.roomId !== roomId) return;

        // Clear typing indicator for the sender (they just sent a message)
        setTypingUsers((prev) => prev.filter((d) => d !== event.data.did));
        const senderTimer = typingTimers.current.get(event.data.did);
        if (senderTimer) {
          clearTimeout(senderTimer);
          typingTimers.current.delete(event.data.did);
        }

        setMessages((prev) => {
          // Dedup: if we have a pending message with same id (rkey), replace it
          const existing = prev.findIndex((m) => m.id === event.data.id);
          if (existing !== -1) {
            const updated = [...prev];
            updated[existing] = {
              id: event.data.id,
              uri: event.data.uri,
              did: event.data.did,
              room_id: event.data.roomId,
              text: event.data.text,
              reply_parent: event.data.reply?.parent ?? null,
              reply_root: event.data.reply?.root ?? null,
              created_at: event.data.createdAt,
              indexed_at: event.data.createdAt,
              pending: false,
            };
            return updated;
          }

          // New message from another user or server — cap to prevent OOM
          const next = [
            ...prev,
            {
              id: event.data.id,
              uri: event.data.uri,
              did: event.data.did,
              room_id: event.data.roomId,
              text: event.data.text,
              reply_parent: event.data.reply?.parent ?? null,
              reply_root: event.data.reply?.root ?? null,
              created_at: event.data.createdAt,
              indexed_at: event.data.createdAt,
            },
          ];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
      } else if (msg.type === 'room_typing') {
        const { roomId: typingRoomId, did: typingDid } = msg.data;
        if (typingRoomId !== roomId || typingDid === did) return;

        setTypingUsers((prev) => (prev.includes(typingDid) ? prev : [...prev, typingDid]));

        // Clear existing timer for this user
        const prevTimer = typingTimers.current.get(typingDid);
        if (prevTimer) clearTimeout(prevTimer);

        const timer = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((d) => d !== typingDid));
          typingTimers.current.delete(typingDid);
        }, 3000);
        typingTimers.current.set(typingDid, timer);
      }
    });

    return () => {
      unsub();
      for (const timer of typingTimers.current.values()) {
        clearTimeout(timer);
      }
      typingTimers.current.clear();
    };
  }, [roomId, subscribe, did]);

  // Send a message with optimistic update
  const sendMessage = useCallback(
    async (text: string, roomUri: string) => {
      if (!agent || !did) return;

      const input: CreateMessageInput = { roomUri, text };

      try {
        const result = await createMessageRecord(agent, input);

        // Optimistic: add pending message immediately using rkey as id
        setMessages((prev) => [
          ...prev,
          {
            id: result.rkey,
            uri: result.uri,
            did,
            room_id: roomId,
            text,
            reply_parent: null,
            reply_root: null,
            created_at: new Date().toISOString(),
            indexed_at: new Date().toISOString(),
            pending: true,
          },
        ]);
      } catch (err) {
        console.error('Failed to send message:', err);
        throw err;
      }
    },
    [agent, did, roomId],
  );

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    send({ type: 'room_typing', roomId });
  }, [send, roomId]);

  return { messages, loading, typingUsers, sendMessage, sendTyping };
}
