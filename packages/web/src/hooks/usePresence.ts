import { useCallback, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';

const VISIBILITY_STORAGE_KEY = 'protoimsg:visibleTo';

export function getCachedVisibility(): PresenceVisibility {
  try {
    const stored = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (
      stored === 'everyone' ||
      stored === 'community' ||
      stored === 'inner-circle' ||
      stored === 'no-one'
    ) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'community';
}

function setCachedVisibility(v: PresenceVisibility): void {
  try {
    localStorage.setItem(VISIBILITY_STORAGE_KEY, v);
  } catch {
    // localStorage unavailable
  }
}

export function usePresence() {
  const [status, setStatus] = useState<PresenceStatus>('online');
  const [awayMessage, setAwayMessage] = useState<string | undefined>();
  const [visibleTo, setVisibleTo] = useState<PresenceVisibility>(getCachedVisibility);
  const { send } = useWebSocket();

  // No initial status_change here. useBuddyList handles the initial
  // sync_community → status_change → request_community_presence sequence
  // so the server has correct community data before broadcasting visibility.

  const changeStatus = useCallback(
    (newStatus: PresenceStatus, newAwayMessage?: string, newVisibleTo?: PresenceVisibility) => {
      const msg = newStatus === 'away' ? newAwayMessage : undefined;
      setStatus(newStatus);
      setAwayMessage(msg);
      if (newVisibleTo) {
        setVisibleTo(newVisibleTo);
        setCachedVisibility(newVisibleTo);
      }

      const effectiveVisibleTo = newVisibleTo ?? visibleTo;

      // Immediate WS broadcast — presence is fully server-side (in-memory)
      send({
        type: 'status_change',
        status: newStatus as 'online' | 'away' | 'idle',
        awayMessage: msg,
        visibleTo: effectiveVisibleTo,
      });
    },
    [send, visibleTo],
  );

  return { status, awayMessage, visibleTo, changeStatus };
}
