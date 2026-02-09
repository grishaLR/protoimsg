import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useWebSocket } from '../contexts/WebSocketContext';

/**
 * Fetches the user's atproto block list and syncs it to the server via WS.
 * Also exposes the set of blocked DIDs for client-side filtering.
 */
export function useBlockSync() {
  const { agent, did } = useAuth();
  const { send, connected } = useWebSocket();
  const [blockedDids, setBlockedDids] = useState<Set<string>>(new Set());
  const hasSynced = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const fetchAndSync = useCallback(async () => {
    if (!agent || !did) return;

    try {
      const blocked: string[] = [];
      let cursor: string | undefined;

      // Paginate through all blocks
      do {
        const res = await agent.app.bsky.graph.getBlocks({ limit: 100, cursor });
        for (const block of res.data.blocks) {
          blocked.push(block.did);
        }
        cursor = res.data.cursor;
      } while (cursor);

      // Also fetch mutes
      let muteCursor: string | undefined;
      do {
        const res = await agent.app.bsky.graph.getMutes({ limit: 100, cursor: muteCursor });
        for (const mute of res.data.mutes) {
          if (!blocked.includes(mute.did)) {
            blocked.push(mute.did);
          }
        }
        muteCursor = res.data.cursor;
      } while (muteCursor);

      setBlockedDids(new Set(blocked));
      sendRef.current({ type: 'sync_blocks', blockedDids: blocked });
    } catch (err) {
      console.error('Failed to sync block list:', err);
    }
  }, [agent, did]);

  // Sync on initial connect
  useEffect(() => {
    if (connected && !hasSynced.current) {
      hasSynced.current = true;
      void fetchAndSync();
    }
    if (!connected) {
      hasSynced.current = false;
    }
  }, [connected, fetchAndSync]);

  const blockedRef = useRef(blockedDids);
  blockedRef.current = blockedDids;

  /** Immediately update the local set and sync to server (no atproto roundtrip) */
  const toggleBlock = useCallback((targetDid: string) => {
    const prev = blockedRef.current;
    const next = new Set(prev);
    if (next.has(targetDid)) {
      next.delete(targetDid);
    } else {
      next.add(targetDid);
    }
    setBlockedDids(next);
    sendRef.current({ type: 'sync_blocks', blockedDids: Array.from(next) });
  }, []);

  return { blockedDids, resync: fetchAndSync, toggleBlock };
}
