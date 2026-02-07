import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createWsClient, type WsClient, type WsHandler } from '../lib/ws';
import type { ClientMessage } from '@chatmosphere/shared';
import { useAuth } from '../hooks/useAuth';

interface WebSocketContextValue {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { did } = useAuth();
  const clientRef = useRef<WsClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!did) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const client = createWsClient(wsUrl, did);
    clientRef.current = client;

    // Poll connection status
    const interval = setInterval(() => {
      setConnected(client.isConnected());
    }, 1000);

    return () => {
      clearInterval(interval);
      client.close();
      clientRef.current = null;
      setConnected(false);
    };
  }, [did]);

  const value: WebSocketContextValue = {
    send(msg) {
      clientRef.current?.send(msg);
    },
    subscribe(handler) {
      return clientRef.current?.subscribe(handler) ?? (() => {});
    },
    connected,
  };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}
