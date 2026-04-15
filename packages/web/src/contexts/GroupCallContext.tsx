import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWebSocket } from './WebSocketContext';
import type { ServerMessage } from '@protoimsg/shared';

export interface GroupCallState {
  callId: string;
  roomId: string;
  token: string;
  url: string;
  participantCount: number;
  /** Short shareable code for standalone meetings, empty for room-attached calls. */
  meetCode: string;
}

interface GroupCallContextValue {
  /** The group call this user is currently in (has a LiveKit token). */
  activeGroupCall: GroupCallState | null;
  /** Create a standalone meeting (not attached to any room). */
  startStandaloneMeeting: (
    access?: 'anyone' | 'community' | 'inner-circle' | 'allowlist',
    allowedDids?: string[],
  ) => void;
  /** Join an existing group call by callId. */
  joinGroupCall: (callId: string) => void;
  /** Join a meeting by its short code. */
  joinByCode: (meetCode: string) => void;
  /** Leave the current group call. */
  leaveGroupCall: () => void;
  /** Whether group calls are supported (LiveKit configured on server). */
  isSupported: boolean;
}

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

export function useGroupCall(): GroupCallContextValue {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error('useGroupCall must be used within GroupCallProvider');
  return ctx;
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, connected } = useWebSocket();

  const [activeGroupCall, setActiveGroupCall] = useState<GroupCallState | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  // Use ref to avoid stale closure in WS handler
  const activeCallRef = useRef(activeGroupCall);
  activeCallRef.current = activeGroupCall;

  // Subscribe to WS messages for group call events
  useEffect(() => {
    const unsubscribe = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'group_call_token': {
          const { callId, token, url, meetCode } = msg.data;
          const existing = activeCallRef.current;
          const roomId = existing?.roomId ?? '';

          setActiveGroupCall({
            callId,
            roomId,
            token,
            url,
            participantCount: 1,
            meetCode: meetCode ?? '',
          });
          break;
        }

        case 'group_call_error': {
          setIsSupported(msg.data.errorCode !== 'SERVER_ERROR' || isSupported);
          break;
        }
      }
    });

    return unsubscribe;
  }, [subscribe, isSupported]);

  // Auto-join a meeting if a pending meet code was saved (e.g. from /meet/:callId before OAuth)
  useEffect(() => {
    if (!connected) return;
    const pending = sessionStorage.getItem('protoimsg:pending_meet_code');
    if (pending) {
      sessionStorage.removeItem('protoimsg:pending_meet_code');
      send({ type: 'group_call_join_by_code', meetCode: pending });
    }
  }, [connected, send]);

  const startStandaloneMeeting = useCallback(
    (access?: 'anyone' | 'community' | 'inner-circle' | 'allowlist', allowedDids?: string[]) => {
      send({
        type: 'group_call_create_standalone',
        access,
        allowedDids,
      });
    },
    [send],
  );

  const joinGroupCall = useCallback(
    (callId: string) => {
      send({ type: 'group_call_join', callId });
    },
    [send],
  );

  const joinByCode = useCallback(
    (meetCode: string) => {
      send({ type: 'group_call_join_by_code', meetCode });
    },
    [send],
  );

  const leaveGroupCall = useCallback(() => {
    const call = activeCallRef.current;
    if (call) {
      send({ type: 'group_call_leave', callId: call.callId });
      setActiveGroupCall(null);
    }
  }, [send]);

  const value = useMemo<GroupCallContextValue>(
    () => ({
      activeGroupCall,
      startStandaloneMeeting,
      joinGroupCall,
      joinByCode,
      leaveGroupCall,
      isSupported,
    }),
    [
      activeGroupCall,
      startStandaloneMeeting,
      joinGroupCall,
      joinByCode,
      leaveGroupCall,
      isSupported,
    ],
  );

  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>;
}
