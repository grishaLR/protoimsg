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

/** Active call indicator for rooms the user is subscribed to (not necessarily joined). */
export interface ActiveRoomCall {
  callId: string;
  participantCount: number;
}

interface GroupCallContextValue {
  /** The group call this user is currently in (has a LiveKit token). */
  activeGroupCall: GroupCallState | null;
  /** Map of roomId → active call info for rooms the user is subscribed to. */
  roomCalls: Map<string, ActiveRoomCall>;
  /** Start or join a group call in a room. */
  startGroupCall: (roomId: string) => void;
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
  const { send, subscribe } = useWebSocket();

  const [activeGroupCall, setActiveGroupCall] = useState<GroupCallState | null>(null);
  const [roomCalls, setRoomCalls] = useState<Map<string, ActiveRoomCall>>(new Map());
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
          // We need the roomId — get it from roomCalls or from the active call
          const existing = activeCallRef.current;
          let roomId = existing?.roomId ?? '';

          // Try to find roomId from roomCalls
          for (const [rid, rc] of roomCalls) {
            if (rc.callId === callId) {
              roomId = rid;
              break;
            }
          }

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

        case 'group_call_started': {
          const { callId, roomId, participantCount } = msg.data;
          setRoomCalls((prev) => {
            const next = new Map(prev);
            next.set(roomId, { callId, participantCount });
            return next;
          });
          // If we just created this call, update roomId on our active call
          setActiveGroupCall((prev) => {
            if (prev && prev.callId === callId && !prev.roomId) {
              return { ...prev, roomId };
            }
            return prev;
          });
          break;
        }

        case 'group_call_ended': {
          const { callId, roomId } = msg.data;
          setRoomCalls((prev) => {
            const next = new Map(prev);
            next.delete(roomId);
            return next;
          });
          setActiveGroupCall((prev) => (prev?.callId === callId ? null : prev));
          break;
        }

        case 'group_call_participant_joined': {
          const { callId, roomId, participantCount } = msg.data;
          setRoomCalls((prev) => {
            const next = new Map(prev);
            next.set(roomId, { callId, participantCount });
            return next;
          });
          setActiveGroupCall((prev) =>
            prev?.callId === callId ? { ...prev, participantCount } : prev,
          );
          break;
        }

        case 'group_call_participant_left': {
          const { callId, roomId, participantCount } = msg.data;
          setRoomCalls((prev) => {
            const next = new Map(prev);
            next.set(roomId, { callId, participantCount });
            return next;
          });
          setActiveGroupCall((prev) =>
            prev?.callId === callId ? { ...prev, participantCount } : prev,
          );
          break;
        }

        case 'group_call_error': {
          setIsSupported(msg.data.errorCode !== 'SERVER_ERROR' || isSupported);
          break;
        }
      }
    });

    return unsubscribe;
  }, [subscribe, roomCalls, isSupported]);

  const startGroupCall = useCallback(
    (roomId: string) => {
      const existing = roomCalls.get(roomId);
      if (existing) {
        send({ type: 'group_call_join', callId: existing.callId });
        return;
      }
      send({ type: 'group_call_create', roomId });
    },
    [send, roomCalls],
  );

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
      roomCalls,
      startGroupCall,
      startStandaloneMeeting,
      joinGroupCall,
      joinByCode,
      leaveGroupCall,
      isSupported,
    }),
    [
      activeGroupCall,
      roomCalls,
      startGroupCall,
      startStandaloneMeeting,
      joinGroupCall,
      joinByCode,
      leaveGroupCall,
      isSupported,
    ],
  );

  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>;
}
