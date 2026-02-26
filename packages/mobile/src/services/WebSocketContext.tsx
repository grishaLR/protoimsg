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
import { AppState, type AppStateStatus } from 'react-native';
import type { ClientMessage } from '@protoimsg/shared';
import { createWsClient, type WsClient, type WsHandler } from './ws';
import { useAuth } from './auth';

interface WebSocketContextValue {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { serverToken, authPhase } = useAuth();
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<WsClient | null>(null);
  const serverTokenRef = useRef(serverToken);
  serverTokenRef.current = serverToken;
  const authPhaseRef = useRef(authPhase);
  authPhaseRef.current = authPhase;

  // Connect when we have a server token and auth is ready
  useEffect(() => {
    if (!serverToken || authPhase !== 'ready') return;

    const client = createWsClient(serverToken, {
      onStatusChange: setConnected,
    });
    clientRef.current = client;

    return () => {
      client.close();
      clientRef.current = null;
      setConnected(false);
    };
  }, [serverToken, authPhase]);

  // Reconnect on app foreground — use refs to avoid stale closure
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (
        nextState === 'active' &&
        serverTokenRef.current &&
        authPhaseRef.current === 'ready' &&
        !clientRef.current?.isConnected()
      ) {
        clientRef.current?.close();
        const client = createWsClient(serverTokenRef.current, {
          onStatusChange: setConnected,
        });
        clientRef.current = client;
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, []);

  // Include `connected` in deps so consumers re-fire effects on reconnect
  const send = useCallback(
    (msg: ClientMessage) => {
      clientRef.current?.send(msg);
    },
    [connected],
  );

  const subscribe = useCallback(
    (handler: WsHandler) => {
      return clientRef.current?.subscribe(handler) ?? (() => {});
    },
    [connected],
  );

  const value = useMemo<WebSocketContextValue>(
    () => ({ send, subscribe, connected }),
    [send, subscribe, connected],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}
