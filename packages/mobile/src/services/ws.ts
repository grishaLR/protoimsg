import type { ClientMessage, ServerMessage } from '@protoimsg/shared';
import { WS_URL } from './config';

export type WsHandler = (msg: ServerMessage) => void;

export interface WsClient {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  close: () => void;
  isConnected: () => boolean;
}

export interface WsClientOptions {
  onStatusChange?: (connected: boolean) => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.3;

/**
 * Create a WebSocket client for the protoimsg server.
 *
 * This is a direct port of the web client's ws.ts — React Native provides
 * a built-in WebSocket that mirrors the browser API, so the logic is identical.
 */
export function createWsClient(token: string, opts?: WsClientOptions): WsClient {
  let ws: WebSocket | null = null;
  let handlers = new Set<WsHandler>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let authFailed = false;
  let authenticated = false;
  let reconnectAttempt = 0;
  const pendingQueue: ClientMessage[] = [];

  function setAuthenticated(value: boolean) {
    if (authenticated === value) return;
    authenticated = value;
    opts?.onStatusChange?.(value);
  }

  function flushQueue() {
    while (pendingQueue.length > 0 && ws?.readyState === WebSocket.OPEN && authenticated) {
      const msg = pendingQueue.shift();
      if (msg) ws.send(JSON.stringify(msg));
    }
  }

  function connect() {
    if (authFailed) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      reconnectAttempt = 0;
      ws?.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'auth_success' && !authenticated) {
        setAuthenticated(true);
        flushQueue();
      }

      for (const handler of handlers) {
        try {
          handler(msg);
        } catch (err) {
          console.error('WS handler error:', err);
        }
      }
    };

    ws.onclose = (event) => {
      setAuthenticated(false);
      if (event.code === 4001) {
        authFailed = true;
        return;
      }
      if (!closed) {
        const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
        const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
        const delay = Math.max(0, Math.round(base + jitter));
        reconnectAttempt++;
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose fires after this, triggering reconnect
    };
  }

  connect();

  return {
    send(msg: ClientMessage) {
      if (authenticated && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else if (!closed && !authFailed) {
        pendingQueue.push(msg);
      }
    },

    subscribe(handler: WsHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    close() {
      closed = true;
      pendingQueue.length = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      handlers = new Set();
    },

    isConnected() {
      return authenticated;
    },
  };
}
