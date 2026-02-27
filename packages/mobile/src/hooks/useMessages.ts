import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChannelMessages } from '@/services/api';
import { NSID } from '@protoimsg/shared';
import { createMessageRecord, generateTid } from '@/services/atproto';
import type { CreateMessageInput } from '@/services/atproto';
import { useWebSocket } from '@/services/WebSocketContext';
import { useAuth } from '@/services/auth';
import type { MessageView } from '@/types';

const MAX_MESSAGES = 500;
const PENDING_MESSAGE_TIMEOUT_MS = 15_000;
const STALE_MS = 5 * 60_000;

// Module-level cache — survives unmounts, cleared on app restart
interface CacheEntry {
  messages: MessageView[];
  ts: number;
}
const channelCache = new Map<string, CacheEntry>();

function cacheKey(roomId: string, channelId: string): string {
  return `${roomId}:${channelId}`;
}

export function useMessages(roomId: string, channelId: string | null) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const { send, subscribe } = useWebSocket();
  const { agent, did } = useAuth();
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSent = useRef(0);

  // Sync messages back to cache whenever they change
  useEffect(() => {
    if (!channelId || messages.length === 0) return;
    const key = cacheKey(roomId, channelId);
    channelCache.set(key, { messages, ts: Date.now() });
  }, [messages, roomId, channelId]);

  // Load message history — show cache immediately, refresh in background
  useEffect(() => {
    if (!channelId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const key = cacheKey(roomId, channelId);
    const cached = channelCache.get(key);
    const isStale = !cached || Date.now() - cached.ts > STALE_MS;

    // Show cached messages immediately (no loading spinner)
    if (cached) {
      setMessages(cached.messages);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }

    setTypingUsers([]);

    // Fetch fresh data in background (or foreground if no cache)
    const ac = new AbortController();

    async function load() {
      try {
        const result = await fetchChannelMessages(roomId, channelId as string, {
          signal: ac.signal,
        });
        if (!ac.signal.aborted) {
          const fresh = result.messages.reverse();
          setMessages(fresh);
          channelCache.set(key, { messages: fresh, ts: Date.now() });
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load messages:', err);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    if (isStale) {
      void load();
    }

    return () => {
      ac.abort();
    };
  }, [roomId, channelId]);

  // Listen for real-time messages + typing via WS
  useEffect(() => {
    if (!channelId) return;

    const unsub = subscribe((msg) => {
      if (msg.type === 'message') {
        const event = msg;
        if (event.data.roomId !== roomId || event.data.channelId !== channelId) return;

        // Clear typing indicator for the sender
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
              channel_id: event.data.channelId,
              text: event.data.text,
              facets: event.data.facets,
              embed: event.data.embed,
              reply_parent: event.data.reply?.parent ?? null,
              reply_root: event.data.reply?.root ?? null,
              created_at: event.data.createdAt,
              indexed_at: event.data.createdAt,
              pending: false,
            };
            return updated;
          }

          // New message — cap to prevent OOM
          const next = [
            ...prev,
            {
              id: event.data.id,
              uri: event.data.uri,
              did: event.data.did,
              room_id: event.data.roomId,
              channel_id: event.data.channelId,
              text: event.data.text,
              facets: event.data.facets,
              embed: event.data.embed,
              reply_parent: event.data.reply?.parent ?? null,
              reply_root: event.data.reply?.root ?? null,
              created_at: event.data.createdAt,
              indexed_at: event.data.createdAt,
            },
          ];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
      } else if (msg.type === 'channel_typing') {
        const { roomId: typingRoomId, channelId: typingChannelId, did: typingDid } = msg.data;
        if (typingRoomId !== roomId || typingChannelId !== channelId || typingDid === did) return;

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
  }, [roomId, channelId, subscribe, did]);

  // Send a message with optimistic update
  const sendMessage = useCallback(
    async (text: string, channelUri: string) => {
      if (!agent || !did || !channelId) return;

      // Pre-generate rkey so we can add the optimistic message immediately
      const rkey = generateTid();
      const uri = `at://${did}/${NSID.Message}/${rkey}`;

      // Optimistic: add pending message BEFORE the API call
      setMessages((prev) => [
        ...prev,
        {
          id: rkey,
          uri,
          did,
          room_id: roomId,
          channel_id: channelId,
          text,
          facets: undefined,
          embed: undefined,
          reply_parent: null,
          reply_root: null,
          created_at: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          pending: true,
        },
      ]);

      const input: CreateMessageInput = {
        channelUri,
        text,
      };

      // Timeout: remove pending message if stuck after 15s
      const pendingTimer = setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== rkey || !m.pending));
      }, PENDING_MESSAGE_TIMEOUT_MS);

      try {
        const result = await createMessageRecord(agent, input, rkey);
        send({ type: 'notify_record', uri: result.uri, cid: result.cid });
      } catch (err) {
        // Rollback optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== rkey));
        console.error('Failed to send message:', err);
        throw err;
      } finally {
        clearTimeout(pendingTimer);
      }
    },
    [agent, did, roomId, channelId, send],
  );

  const sendTyping = useCallback(() => {
    if (!channelId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    send({ type: 'channel_typing', roomId, channelId });
  }, [send, roomId, channelId]);

  return { messages, loading, typingUsers, sendMessage, sendTyping };
}
