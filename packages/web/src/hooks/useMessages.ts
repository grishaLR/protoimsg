import { useCallback, useEffect, useState } from 'react';
import { fetchMessages } from '../lib/api';
import { createMessageRecord, type CreateMessageInput } from '../lib/atproto';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from './useAuth';
import type { MessageView } from '../types';

export function useMessages(roomId: string) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();
  const { agent, did } = useAuth();

  // Load message history
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchMessages(roomId);
        if (!cancelled) {
          // API returns newest-first, reverse for chronological display
          setMessages(data.reverse());
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Listen for real-time messages via WS
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type !== 'message') return;
      const event = msg;
      if (event.data.roomId !== roomId) return;

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
            reply_to: event.data.replyTo ?? null,
            created_at: event.data.createdAt,
            indexed_at: event.data.createdAt,
            pending: false,
          };
          return updated;
        }

        // New message from another user or server
        return [
          ...prev,
          {
            id: event.data.id,
            uri: event.data.uri,
            did: event.data.did,
            room_id: event.data.roomId,
            text: event.data.text,
            reply_to: event.data.replyTo ?? null,
            created_at: event.data.createdAt,
            indexed_at: event.data.createdAt,
          },
        ];
      });
    });

    return unsub;
  }, [roomId, subscribe]);

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
            reply_to: null,
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

  return { messages, loading, sendMessage };
}
