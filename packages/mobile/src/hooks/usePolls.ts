import { useCallback, useEffect, useState } from 'react';
import { fetchChannelPolls } from '@/services/api';
import { createVoteRecord } from '@/services/atproto';
import { useWebSocket } from '@/services/WebSocketContext';
import { useAuth } from '@/services/auth';
import type { PollView } from '@/types';

export function usePolls(roomId: string, channelId: string | null) {
  const [polls, setPolls] = useState<PollView[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();
  const { agent, did } = useAuth();

  // Load polls on mount or channel change
  useEffect(() => {
    if (!channelId) {
      setPolls([]);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setPolls([]);

    async function load() {
      try {
        const data = await fetchChannelPolls(roomId, channelId as string, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setPolls(data);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load polls:', err);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => {
      ac.abort();
    };
  }, [roomId, channelId]);

  // Subscribe to WS poll events
  useEffect(() => {
    if (!channelId) return;

    const unsub = subscribe((msg) => {
      if (msg.type === 'poll_created') {
        const event = msg;
        if (event.data.roomId !== roomId || event.data.channelId !== channelId) return;

        setPolls((prev) => {
          const existing = prev.findIndex((p) => p.id === event.data.id);
          if (existing !== -1) {
            const updated = [...prev];
            updated[existing] = {
              ...updated[existing],
              uri: event.data.uri,
              pending: false,
            } as PollView;
            return updated;
          }

          return [
            ...prev,
            {
              id: event.data.id,
              uri: event.data.uri,
              did: event.data.did,
              room_id: event.data.roomId,
              channel_id: event.data.channelId,
              question: event.data.question,
              options: event.data.options,
              allow_multiple: event.data.allowMultiple,
              expires_at: event.data.expiresAt ?? null,
              created_at: event.data.createdAt,
              indexed_at: event.data.createdAt,
              tallies: {},
              totalVoters: 0,
              myVote: null,
            },
          ];
        });
      } else if (msg.type === 'poll_vote') {
        const event = msg;
        if (event.data.roomId !== roomId || event.data.channelId !== channelId) return;

        setPolls((prev) =>
          prev.map((p) => {
            if (p.id !== event.data.pollId) return p;
            const updated: PollView = {
              ...p,
              tallies: event.data.tallies,
              totalVoters: event.data.totalVoters,
            };
            if (event.data.voterDid === did) {
              updated.myVote = event.data.selectedOptions;
            }
            return updated;
          }),
        );
      }
    });

    return unsub;
  }, [roomId, channelId, subscribe, did]);

  // Cast a vote with optimistic update
  const castVote = useCallback(
    async (pollId: string, pollUri: string, selectedOptions: number[]) => {
      if (!agent || !did) return;

      setPolls((prev) =>
        prev.map((p) => {
          if (p.id !== pollId) return p;
          const newTallies = { ...p.tallies };

          if (p.myVote) {
            for (const idx of p.myVote) {
              newTallies[idx] = Math.max(0, (newTallies[idx] ?? 0) - 1);
            }
          }

          for (const idx of selectedOptions) {
            newTallies[idx] = (newTallies[idx] ?? 0) + 1;
          }

          return {
            ...p,
            tallies: newTallies,
            totalVoters: p.myVote ? p.totalVoters : p.totalVoters + 1,
            myVote: selectedOptions,
          };
        }),
      );

      try {
        await createVoteRecord(agent, { pollUri, selectedOptions });
      } catch (err) {
        console.error('Failed to cast vote:', err);
        if (channelId) {
          try {
            const data = await fetchChannelPolls(roomId, channelId);
            setPolls(data);
          } catch {
            // ignore refetch failure
          }
        }
        throw err;
      }
    },
    [agent, did, roomId, channelId],
  );

  return { polls, loading, castVote };
}
