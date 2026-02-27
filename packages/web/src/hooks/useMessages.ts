import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { RichText as RichTextAPI } from '@atproto/api';
import { fetchChannelMessages } from '../lib/api';
import { NSID } from '@protoimsg/shared';
import { createMessageRecord, generateTid, type CreateMessageInput } from '../lib/atproto';
import { parseMarkdownFacets } from '../lib/markdown-facets';
import { hasMentionOf } from '../lib/facet-utils';
import { playImNotify } from '../lib/sounds';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from './useAuth';
import type { MessageView } from '../types';
import { Sentry } from '../sentry';

const MAX_MESSAGES = 500;
const PENDING_MESSAGE_TIMEOUT_MS = 15_000;

interface ChannelData {
  messages: MessageView[];
  replyCounts: Record<string, number>;
}

function channelQueryKey(roomId: string, channelId: string) {
  return ['channelMessages', roomId, channelId] as const;
}

export function useMessages(roomId: string, channelId: string | null) {
  const queryClient = useQueryClient();
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const { send, subscribe } = useWebSocket();
  const { agent, did } = useAuth();
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSent = useRef(0);

  // Fetch messages via React Query — cached across room navigation
  const { data, isLoading } = useQuery({
    queryKey: channelId ? channelQueryKey(roomId, channelId) : ['channelMessages', roomId, null],
    queryFn: async ({ signal }) => {
      // channelId is guaranteed non-null by enabled: !!channelId
      const result = await fetchChannelMessages(roomId, channelId as string, { signal });
      return { messages: result.messages.reverse(), replyCounts: result.replyCounts };
    },
    enabled: !!channelId,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const messages = data?.messages ?? [];
  const replyCounts = data?.replyCounts ?? {};
  const loading = !!channelId && isLoading;

  // Reset typing users when switching channels
  useEffect(() => {
    setTypingUsers([]);
    return () => {
      for (const timer of typingTimers.current.values()) {
        clearTimeout(timer);
      }
      typingTimers.current.clear();
    };
  }, [roomId, channelId]);

  // Listen for real-time messages + typing via WS
  useEffect(() => {
    if (!channelId) return;
    const qk = channelQueryKey(roomId, channelId);

    const unsub = subscribe((msg) => {
      if (msg.type === 'message') {
        const event = msg;
        if (event.data.roomId !== roomId || event.data.channelId !== channelId) return;

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

        const incoming: MessageView = {
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
        };

        queryClient.setQueryData<ChannelData>(qk, (prev) => {
          if (!prev) return { messages: [incoming], replyCounts: {} };

          // If this is a reply, increment the reply count for its root
          const replyRoot = event.data.reply?.root;
          const nextReplyCounts = replyRoot
            ? { ...prev.replyCounts, [replyRoot]: (prev.replyCounts[replyRoot] ?? 0) + 1 }
            : prev.replyCounts;

          // Dedup: if we have a pending message with same id (rkey), replace it
          const existing = prev.messages.findIndex((m) => m.id === event.data.id);
          if (existing !== -1) {
            const updated = [...prev.messages];
            updated[existing] = { ...incoming, pending: false };
            return { messages: updated, replyCounts: nextReplyCounts };
          }

          // New message — cap to prevent OOM
          const next = [...prev.messages, incoming];
          return {
            messages: next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next,
            replyCounts: nextReplyCounts,
          };
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
    };
  }, [roomId, channelId, subscribe, did, queryClient]);

  // Send a message with optimistic update
  const sendMessage = useCallback(
    async (
      text: string,
      channelUri: string,
      reply?: { root: string; parent: string },
      embed?: Record<string, unknown>,
    ) => {
      if (!agent || !did || !channelId) return;
      const qk = channelQueryKey(roomId, channelId);

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

      const optimistic: MessageView = {
        id: rkey,
        uri,
        did,
        room_id: roomId,
        channel_id: channelId,
        text: cleaned,
        facets: allFacets.length > 0 ? allFacets : undefined,
        embed,
        reply_parent: reply?.parent ?? null,
        reply_root: reply?.root ?? null,
        created_at: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        pending: true,
      };

      // Optimistic: add pending message BEFORE the API call
      queryClient.setQueryData<ChannelData>(qk, (prev) => {
        if (!prev) return { messages: [optimistic], replyCounts: {} };
        return { ...prev, messages: [...prev.messages, optimistic] };
      });

      const input: CreateMessageInput = {
        channelUri,
        text: cleaned,
        facets: allFacets.length > 0 ? allFacets : undefined,
        reply,
        embed,
      };

      // Timeout: remove pending message if it's still stuck after 15s
      const pendingTimer = setTimeout(() => {
        Sentry.captureMessage('Pending message timeout — message stuck for 15s', {
          level: 'warning',
          tags: { component: 'useMessages' },
          extra: { roomId, channelId, rkey },
        });
        queryClient.setQueryData<ChannelData>(qk, (prev) => {
          if (!prev) return prev;
          return { ...prev, messages: prev.messages.filter((m) => m.id !== rkey || !m.pending) };
        });
      }, PENDING_MESSAGE_TIMEOUT_MS);

      try {
        const result = await createMessageRecord(agent, input, rkey);
        send({ type: 'notify_record', uri: result.uri, cid: result.cid });
      } catch (err) {
        // Rollback optimistic message on failure
        queryClient.setQueryData<ChannelData>(qk, (prev) => {
          if (!prev) return prev;
          return { ...prev, messages: prev.messages.filter((m) => m.id !== rkey) };
        });
        console.error('Failed to send message:', err);
        throw err;
      } finally {
        clearTimeout(pendingTimer);
      }
    },
    [agent, did, roomId, channelId, queryClient, send],
  );

  const sendTyping = useCallback(() => {
    if (!channelId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    send({ type: 'channel_typing', roomId, channelId });
  }, [send, roomId, channelId]);

  return { messages, replyCounts, loading, typingUsers, sendMessage, sendTyping };
}
