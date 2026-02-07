import type { ClientMessage, ServerMessage } from '@chatmosphere/shared';

export type WsHandler = (msg: ServerMessage) => void;

export interface WsClient {
  send: (msg: ClientMessage) => void;
  subscribe: (handler: WsHandler) => () => void;
  close: () => void;
  isConnected: () => boolean;
}

export function createWsClient(url: string, did: string): WsClient {
  let ws: WebSocket | null = null;
  let handlers = new Set<WsHandler>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      // Server expects first message to include DID
      ws?.send(JSON.stringify({ did }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const handler of handlers) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
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
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      handlers = new Set();
    },

    isConnected() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}
