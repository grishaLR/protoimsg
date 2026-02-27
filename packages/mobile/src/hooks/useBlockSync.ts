import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/services/auth';
import { useWebSocket } from '@/services/WebSocketContext';

/**
 * Fetches the user's atproto block + mute lists and syncs them to the server via WS.
 * Port of packages/web/src/hooks/useBlockSync.ts.
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

  return { blockedDids, resync: fetchAndSync };
}
