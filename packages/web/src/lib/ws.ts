import type { ClientMessage, ServerMessage } from '@protoimsg/shared';

export type WsHandler = (msg: ServerMessage) => void;

export interface WsClient {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  close: () => void;
  isConnected: () => boolean;
}

export interface WsClientOptions {
  /** Called when the authenticated connection state changes. */
  onStatusChange?: (connected: boolean) => void;
}

export function createWsClient(url: string, token: string, opts?: WsClientOptions): WsClient {
  let ws: WebSocket | null = null;
  let handlers = new Set<WsHandler>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let authFailed = false;
  let authenticated = false;
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
    ws = new WebSocket(url);

    ws.onopen = () => {
      // Send auth token as first message
      ws?.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;

        // Track auth success to enable message sending
        if (msg.type === 'auth_success' && !authenticated) {
          setAuthenticated(true);
          flushQueue();
        }

        for (const handler of handlers) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      setAuthenticated(false);
      // 4001 = auth failure — don't reconnect
      if (event.code === 4001) {
        authFailed = true;
        return;
      }
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  connect();

  return {
    send(msg: ClientMessage) {
      if (authenticated && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else if (!closed && !authFailed) {
        // Queue messages sent before auth completes — flushed on auth_success
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
