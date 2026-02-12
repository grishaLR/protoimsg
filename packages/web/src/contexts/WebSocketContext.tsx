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
import { createWsClient, type WsClient, type WsHandler } from '../lib/ws';
import type { ClientMessage } from '@protoimsg/shared';
import { useAuth } from '../hooks/useAuth';
import { API_URL, IS_TAURI } from '../lib/config';

interface WebSocketContextValue {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { did, serverToken } = useAuth();
  const clientRef = useRef<WsClient | null>(null);
  const [connected, setConnected] = useState(false);
  const relayCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!did || !serverToken) return;

    // Capture token value for use inside async closure (non-null after the guard above)
    const token = serverToken;
    let cancelled = false;

    async function init() {
      let client: WsClient;

      if (IS_TAURI) {
        const { isMainWindow } = await import('../lib/tauri-windows');

        if (isMainWindow()) {
          // Main window: create real WS + install IPC relay for child windows
          const wsUrl = API_URL
            ? `${API_URL.replace(/^http/, 'ws')}/ws`
            : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
          client = createWsClient(wsUrl, token, { onStatusChange: setConnected });

          const { installRelay } = await import('../lib/ws-ipc-relay');
          relayCleanupRef.current = installRelay(client);
        } else {
          // Child window: use virtual WsClient backed by IPC events
          const { createIpcWsClient } = await import('../lib/ws-ipc-relay');
          client = createIpcWsClient();
          setConnected(true);
        }
      } else {
        // Browser mode: normal WebSocket
        const wsUrl = API_URL
          ? `${API_URL.replace(/^http/, 'ws')}/ws`
          : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
        client = createWsClient(wsUrl, token, { onStatusChange: setConnected });
      }

      if (cancelled) {
        client.close();
        return;
      }

      clientRef.current = client;
    }

    void init();

    return () => {
      cancelled = true;
      relayCleanupRef.current?.();
      relayCleanupRef.current = null;
      clientRef.current?.close();
      clientRef.current = null;
      setConnected(false);
    };
  }, [did, serverToken]);

  // Both `send` and `subscribe` depend on `connected` so that consumer effects
  // re-run when the WS client connects. Without this, effects that fire before
  // the client is ready get stale no-ops and never retry.
  const send = useCallback(
    (msg: ClientMessage) => {
      if (!connected) return;
      clientRef.current?.send(msg);
    },
    [connected],
  );

  const subscribe = useCallback(
    (handler: WsHandler) => {
      if (!connected) return () => {};
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

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}
