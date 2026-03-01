import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

const PAGE_SIZE = 100;
const PUBLIC_API = 'https://public.api.bsky.app/xrpc';

export interface FollowGraphEntry {
  did: string;
}

interface PaginatedList {
  items: FollowGraphEntry[];
  cursor: string | undefined;
  hasMore: boolean;
  loading: boolean;
}

interface PublicFollowersResponse {
  followers: Array<{ did: string }>;
  cursor?: string;
}

interface PublicFollowsResponse {
  follows: Array<{ did: string }>;
  cursor?: string;
}

const EMPTY: PaginatedList = { items: [], cursor: undefined, hasMore: true, loading: false };

async function fetchFollowers(
  actor: string,
  limit: number,
  cursor?: string,
): Promise<PublicFollowersResponse> {
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${PUBLIC_API}/app.bsky.graph.getFollowers?${params}`);
  if (!res.ok) throw new Error(`getFollowers failed: ${res.status}`);
  return (await res.json()) as PublicFollowersResponse;
}

async function fetchFollows(
  actor: string,
  limit: number,
  cursor?: string,
): Promise<PublicFollowsResponse> {
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${PUBLIC_API}/app.bsky.graph.getFollows?${params}`);
  if (!res.ok) throw new Error(`getFollows failed: ${res.status}`);
  return (await res.json()) as PublicFollowsResponse;
}

export function useFollowGraph() {
  const { did } = useAuth();
  const [followers, setFollowers] = useState<PaginatedList>(EMPTY);
  const [following, setFollowing] = useState<PaginatedList>(EMPTY);

  // Initial fetch — first page only (public API, no OAuth proxy needed)
  useEffect(() => {
    if (!did) return;

    let cancelled = false;

    async function fetchFirstPage() {
      if (!did) return;

      try {
        const [followersRes, followingRes] = await Promise.all([
          fetchFollowers(did, PAGE_SIZE),
          fetchFollows(did, PAGE_SIZE),
        ]);

        if (cancelled) return;

        setFollowers({
          items: followersRes.followers.map((f) => ({ did: f.did })),
          cursor: followersRes.cursor,
          hasMore: !!followersRes.cursor,
          loading: false,
        });

        setFollowing({
          items: followingRes.follows.map((f) => ({ did: f.did })),
          cursor: followingRes.cursor,
          hasMore: !!followingRes.cursor,
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
  }, [did]);

  const fetchMoreFollowers = useCallback(async () => {
    if (!did || !followers.hasMore || followers.loading) return;

    setFollowers((prev) => ({ ...prev, loading: true }));

    try {
      const res = await fetchFollowers(did, PAGE_SIZE, followers.cursor);

      setFollowers((prev) => ({
        items: [...prev.items, ...res.followers.map((f) => ({ did: f.did }))],
        cursor: res.cursor,
        hasMore: !!res.cursor,
        loading: false,
      }));
    } catch (err) {
      console.error('Failed to fetch more followers:', err);
      setFollowers((prev) => ({ ...prev, loading: false }));
    }
  }, [did, followers.hasMore, followers.loading, followers.cursor]);

  const fetchMoreFollowing = useCallback(async () => {
    if (!did || !following.hasMore || following.loading) return;

    setFollowing((prev) => ({ ...prev, loading: true }));

    try {
      const res = await fetchFollows(did, PAGE_SIZE, following.cursor);

      setFollowing((prev) => ({
        items: [...prev.items, ...res.follows.map((f) => ({ did: f.did }))],
        cursor: res.cursor,
        hasMore: !!res.cursor,
        loading: false,
      }));
    } catch (err) {
      console.error('Failed to fetch more following:', err);
      setFollowing((prev) => ({ ...prev, loading: false }));
    }
  }, [did, following.hasMore, following.loading, following.cursor]);

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
