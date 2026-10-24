import { useCallback, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';
import {
  effectiveVisibility,
  getCachedVisibility,
  getCurrentStatus,
  setCachedVisibility,
  setCurrentStatus,
  type SentStatus,
} from '../lib/presence-state';

export { getCachedVisibility };

export function usePresence() {
  const [status, setStatus] = useState<PresenceStatus>(() => getCurrentStatus().status);
  const [awayMessage, setAwayMessage] = useState<string | undefined>(
    () => getCurrentStatus().awayMessage,
  );
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

      setCurrentStatus({ status: newStatus as SentStatus, awayMessage: msg });

      // Immediate WS broadcast — presence is fully server-side (in-memory)
      send({
        type: 'status_change',
        status: newStatus as SentStatus,
        awayMessage: msg,
        visibleTo: effectiveVisibility(),
      });
    },
    [send],
  );

  return { status, awayMessage, visibleTo, changeStatus };
}
