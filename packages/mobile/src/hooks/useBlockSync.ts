import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/services/auth';
import { useWebSocket } from '@/services/WebSocketContext';

/**
 * Fetches the user's atproto block list and syncs it to the server via WS.
 * Uses listRecords (direct PDS call) instead of getBlocks (appview proxy)
 * to avoid needing feed/moderation scopes.
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

      // Use listRecords for blocks — direct PDS call, no appview proxy.
      // Avoids needing fine-grained feed/moderation scopes.
      let cursor: string | undefined;
      do {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: 'app.bsky.graph.block',
          limit: 100,
          cursor,
        });
        for (const rec of res.data.records) {
          const subject = (rec.value as { subject?: string }).subject;
          if (subject) blocked.push(subject);
        }
        cursor = res.data.cursor;
      } while (cursor);

      // Mutes are appview-managed (no repo records) and require feed scopes.
      // Mobile doesn't request feed scopes, so skip mutes entirely.

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
