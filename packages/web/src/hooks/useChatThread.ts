import { useCallback, useEffect, useMemo, useState } from 'react';
import { RichText as RichTextAPI } from '@atproto/api';
import { NSID } from '@protoimsg/shared';
import { fetchThreadMessages } from '../lib/api';
import { createMessageRecord, generateTid, type CreateMessageInput } from '../lib/atproto';
import { parseMarkdownFacets } from '../lib/markdown-facets';
import { useAuth } from './useAuth';
import type { MessageView } from '../types';

export interface ChatThreadState {
  /** Root message URI */
  rootUri: string;
  /** Room ID the thread belongs to */
  roomId: string;
}

/**
 * Hook for thread panel state.
 *
 * `liveMessages` comes from the parent's `useMessages` hook, which already
 * receives real-time WS updates for the room. We merge them with the initial
 * fetch (which may include older messages not in the live window) to get a
 * complete, always-up-to-date thread view.
 */
export function useChatThread(thread: ChatThreadState | null, liveMessages: MessageView[]) {
  const [fetchedMessages, setFetchedMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(false);
  const { agent, did } = useAuth();

  // Load thread messages when thread opens
  useEffect(() => {
    if (!thread) {
      setFetchedMessages([]);
      return;
    }

    const { roomId, rootUri } = thread;
    const ac = new AbortController();
    setLoading(true);

    async function load() {
      try {
        const data = await fetchThreadMessages(roomId, rootUri, {
          signal: ac.signal,
        });
        if (!ac.signal.aborted) {
          setFetchedMessages(data);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load thread:', err);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => {
      ac.abort();
    };
  }, [thread?.rootUri, thread?.roomId]);

  // Merge fetched messages with live messages from useMessages.
  // Live messages (from WS) include both root and reply messages for
  // the whole room; we filter to only those belonging to this thread.
  const messages = useMemo(() => {
    if (!thread) return [];

    // Filter live messages to this thread
    const threadLive = liveMessages.filter(
      (m) => m.uri === thread.rootUri || m.reply_root === thread.rootUri,
    );

    // Merge: live messages take precedence (they have confirmed state)
    const byId = new Map<string, MessageView>();
    for (const m of fetchedMessages) byId.set(m.id, m);
    for (const m of threadLive) byId.set(m.id, m);

    return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [thread, fetchedMessages, liveMessages]);

  // Send a reply in the thread
  const sendReply = useCallback(
    async (text: string, roomUri: string, parentUri?: string) => {
      if (!agent || !did || !thread) return;

      // Parse markdown → cleaned text + formatting facets
      const { text: cleaned, facets: mdFacets } = parseMarkdownFacets(text);

      // Detect semantic facets (mentions, links, tags) on the cleaned text
      const rt = new RichTextAPI({ text: cleaned });
      await rt.detectFacets(agent);

      const allFacets = [...mdFacets, ...(rt.facets ?? [])] as Record<string, unknown>[];

      const reply = {
        root: thread.rootUri,
        parent: parentUri ?? thread.rootUri,
      };

      // Pre-generate rkey so we can add the optimistic message immediately
      const rkey = generateTid();
      const uri = `at://${did}/${NSID.Message}/${rkey}`;

      // Optimistic: add pending message BEFORE the API call.
      // Added to fetchedMessages so it appears before the WS echo arrives.
      setFetchedMessages((prev) => [
        ...prev,
        {
          id: rkey,
          uri,
          did,
          room_id: thread.roomId,
          text: cleaned,
          facets: allFacets.length > 0 ? allFacets : undefined,
          reply_parent: reply.parent,
          reply_root: reply.root,
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
        setFetchedMessages((prev) => prev.filter((m) => m.id !== rkey));
        console.error('Failed to send thread reply:', err);
        throw err;
      }
    },
    [agent, did, thread],
  );

  return { messages, loading, sendReply };
}
