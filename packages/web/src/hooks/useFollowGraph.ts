import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

const PAGE_SIZE = 100;

export interface FollowGraphEntry {
  did: string;
}

interface PaginatedList {
  items: FollowGraphEntry[];
  cursor: string | undefined;
  hasMore: boolean;
  loading: boolean;
}

const EMPTY: PaginatedList = { items: [], cursor: undefined, hasMore: true, loading: false };

export function useFollowGraph() {
  const { agent, did, hasBskyReads } = useAuth();
  const [followers, setFollowers] = useState<PaginatedList>(EMPTY);
  const [following, setFollowing] = useState<PaginatedList>(EMPTY);

  // Initial fetch — first page only
  useEffect(() => {
    if (!agent || !did || !hasBskyReads) return;

    let cancelled = false;

    async function fetchFirstPage() {
      if (!agent || !did) return;

      try {
        const [followersRes, followingRes] = await Promise.all([
          agent.app.bsky.graph.getFollowers({ actor: did, limit: PAGE_SIZE }),
          agent.app.bsky.graph.getFollows({ actor: did, limit: PAGE_SIZE }),
        ]);

        if (cancelled) return;

        setFollowers({
          items: followersRes.data.followers.map((f) => ({ did: f.did })),
          cursor: followersRes.data.cursor,
          hasMore: !!followersRes.data.cursor,
          loading: false,
        });

        setFollowing({
          items: followingRes.data.follows.map((f) => ({ did: f.did })),
          cursor: followingRes.data.cursor,
          hasMore: !!followingRes.data.cursor,
          loading: false,
        });
      } catch (err) {
        console.error('Failed to fetch follow graph:', err);
      }
    }

    void fetchFirstPage();

    return () => {
      cancelled = true;
    };
  }, [agent, did, hasBskyReads]);

  const fetchMoreFollowers = useCallback(async () => {
    if (!agent || !did || !hasBskyReads || !followers.hasMore || followers.loading) return;

    setFollowers((prev) => ({ ...prev, loading: true }));

    try {
      const res = await agent.app.bsky.graph.getFollowers({
        actor: did,
        limit: PAGE_SIZE,
        cursor: followers.cursor,
      });

      setFollowers((prev) => ({
        items: [...prev.items, ...res.data.followers.map((f) => ({ did: f.did }))],
        cursor: res.data.cursor,
        hasMore: !!res.data.cursor,
        loading: false,
      }));
    } catch (err) {
      console.error('Failed to fetch more followers:', err);
      setFollowers((prev) => ({ ...prev, loading: false }));
    }
  }, [agent, did, hasBskyReads, followers.hasMore, followers.loading, followers.cursor]);

  const fetchMoreFollowing = useCallback(async () => {
    if (!agent || !did || !hasBskyReads || !following.hasMore || following.loading) return;

    setFollowing((prev) => ({ ...prev, loading: true }));

    try {
      const res = await agent.app.bsky.graph.getFollows({
        actor: did,
        limit: PAGE_SIZE,
        cursor: following.cursor,
      });

      setFollowing((prev) => ({
        items: [...prev.items, ...res.data.follows.map((f) => ({ did: f.did }))],
        cursor: res.data.cursor,
        hasMore: !!res.data.cursor,
        loading: false,
      }));
    } catch (err) {
      console.error('Failed to fetch more following:', err);
      setFollowing((prev) => ({ ...prev, loading: false }));
    }
  }, [agent, did, hasBskyReads, following.hasMore, following.loading, following.cursor]);

  return {
    followers: followers.items,
    following: following.items,
    loading: followers.loading || following.loading,
    fetchMoreFollowers,
    fetchMoreFollowing,
    hasMoreFollowers: followers.hasMore,
    hasMoreFollowing: following.hasMore,
  };
}
