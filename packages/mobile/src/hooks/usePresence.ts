import { useCallback, useState } from 'react';
import { useWebSocket } from '@/services/WebSocketContext';
import { useAuth } from '@/services/auth';
import { putPresenceRecord } from '@/services/atproto';
import { getStoredVisibility, setStoredVisibility } from '@/services/storage';
import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';

const WS_STATUSES = ['online', 'away', 'idle'] as const;
type WsStatus = (typeof WS_STATUSES)[number];

function isWsStatus(value: string): value is WsStatus {
  return (WS_STATUSES as readonly string[]).includes(value);
}

export function getCachedVisibility(): PresenceVisibility {
  const stored = getStoredVisibility();
  if (
    stored === 'everyone' ||
    stored === 'community' ||
    stored === 'inner-circle' ||
    stored === 'no-one'
  ) {
    return stored;
  }
  return 'community';
}

export function usePresence() {
  const [status, setStatus] = useState<PresenceStatus>('online');
  const [awayMessage, setAwayMessage] = useState<string | undefined>();
  const [visibleTo, setVisibleTo] = useState<PresenceVisibility>(getCachedVisibility);
  const { send } = useWebSocket();
  const { agent } = useAuth();

  const changeStatus = useCallback(
    (newStatus: PresenceStatus, newAwayMessage?: string, newVisibleTo?: PresenceVisibility) => {
      const msg = newStatus === 'away' ? newAwayMessage : undefined;
      setStatus(newStatus);
      setAwayMessage(msg);
      if (newVisibleTo) {
        setVisibleTo(newVisibleTo);
        setStoredVisibility(newVisibleTo);
      }

      const effectiveVisibleTo = newVisibleTo ?? visibleTo;

      if (isWsStatus(newStatus)) {
        send({
          type: 'status_change',
          status: newStatus,
          awayMessage: msg,
          visibleTo: effectiveVisibleTo,
        });
      }

      if (agent) {
        void putPresenceRecord(agent, newStatus, { awayMessage: msg });
      }
    },
    [send, agent, visibleTo],
  );

  return { status, awayMessage, visibleTo, changeStatus };
}
