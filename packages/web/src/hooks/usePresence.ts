import { useCallback, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from './useAuth';
import { putPresenceRecord } from '../lib/atproto';
import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';

export function usePresence() {
  const [status, setStatus] = useState<PresenceStatus>('online');
  const [awayMessage, setAwayMessage] = useState<string | undefined>();
  const [visibleTo, setVisibleTo] = useState<PresenceVisibility>('everyone');
  const { send } = useWebSocket();
  const { agent } = useAuth();

  const changeStatus = useCallback(
    (newStatus: PresenceStatus, newAwayMessage?: string, newVisibleTo?: PresenceVisibility) => {
      const msg = newStatus === 'away' ? newAwayMessage : undefined;
      setStatus(newStatus);
      setAwayMessage(msg);
      if (newVisibleTo) setVisibleTo(newVisibleTo);

      const effectiveVisibleTo = newVisibleTo ?? visibleTo;

      // Immediate WS broadcast
      send({
        type: 'status_change',
        status: newStatus as 'online' | 'away' | 'idle',
        awayMessage: msg,
        visibleTo: effectiveVisibleTo,
      });

      // Fire-and-forget ATProto presence record write
      if (agent) {
        void putPresenceRecord(agent, newStatus, {
          awayMessage: msg,
          visibleTo: effectiveVisibleTo,
        });
      }
    },
    [send, agent, visibleTo],
  );

  return { status, awayMessage, visibleTo, changeStatus };
}
