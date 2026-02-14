import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText as RichTextAPI } from '@atproto/api';
import { fetchMessages } from '../lib/api';
import { NSID } from '@protoimsg/shared';
import { createMessageRecord, generateTid, type CreateMessageInput } from '../lib/atproto';
import { parseMarkdownFacets } from '../lib/markdown-facets';
import { hasMentionOf } from '../lib/facet-utils';
import { playImNotify } from '../lib/sounds';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from './useAuth';
import type { MessageView } from '../types';

const MAX_MESSAGES = 500;

export function useMessages(roomId: string) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
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
        const result = await fetchMessages(roomId, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setMessages(result.messages.reverse());
          setReplyCounts(result.replyCounts);
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

        // Play notification sound when someone else mentions us
        if (did && event.data.did !== did && hasMentionOf(event.data.facets, did)) {
          playImNotify();
        }

        // If this is a reply, increment the reply count for its root
        const replyRoot = event.data.reply?.root;
        if (replyRoot) {
          setReplyCounts((prev) => ({
            ...prev,
            [replyRoot]: (prev[replyRoot] ?? 0) + 1,
          }));
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
              facets: event.data.facets,
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
              facets: event.data.facets,
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
    async (text: string, roomUri: string, reply?: { root: string; parent: string }) => {
      if (!agent || !did) return;

      // Parse markdown → cleaned text + formatting facets
      const { text: cleaned, facets: mdFacets } = parseMarkdownFacets(text);

      // Detect semantic facets (mentions, links, tags) on the cleaned text
      const rt = new RichTextAPI({ text: cleaned });
      await rt.detectFacets(agent);

      // Merge markdown facets with detected semantic facets
      const allFacets = [...mdFacets, ...(rt.facets ?? [])] as Record<string, unknown>[];

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
          text: cleaned,
          facets: allFacets.length > 0 ? allFacets : undefined,
          reply_parent: reply?.parent ?? null,
          reply_root: reply?.root ?? null,
          created_at: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          pending: true,
        },
      ]);

      const input: CreateMessageInput = {
        roomUri,
        text: cleaned,
        facets: allFacets.length > 0 ? allFacets : undefined,
        reply,
      };

      try {
        await createMessageRecord(agent, input, rkey);
      } catch (err) {
        // Rollback optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== rkey));
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

  return { messages, replyCounts, loading, typingUsers, sendMessage, sendTyping };
}
