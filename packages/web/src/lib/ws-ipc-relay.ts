/**
 * WS ↔ IPC relay for Tauri multi-window.
 *
 * Main window: owns the real WebSocket, relays all ServerMessages to child windows via Tauri events.
 * Child windows: use a virtual WsClient that sends/receives via Tauri events instead of a real WebSocket.
 *
 * Dynamically imported only when IS_TAURI is true.
 */

import { emit, listen } from '@tauri-apps/api/event';
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event';
import type { WsClient, WsHandler } from './ws';
import type { ClientMessage, ServerMessage } from '@chatmosphere/shared';

const WS_SERVER_MESSAGE = 'ws:server-message';
const WS_CLIENT_MESSAGE = 'ws:client-message';

/**
 * Install on the main window: relays all ServerMessages from the real WsClient
 * to child windows, and forwards ClientMessages from child windows to the real WS.
 */
export function installRelay(wsClient: WsClient): () => void {
  // Relay server messages to all windows
  const unsubscribe = wsClient.subscribe((msg: ServerMessage) => {
    void emit(WS_SERVER_MESSAGE, msg);
  });

  // Listen for client messages from child windows
  let unlistenPromise: Promise<UnlistenFn> | null = listen<ClientMessage>(
    WS_CLIENT_MESSAGE,
    (event: TauriEvent<ClientMessage>) => {
      wsClient.send(event.payload);

      // When a child window closes a DM, notify the main window's DmContext
      // so it removes the stale conversation entry from its own state.
      const msg = event.payload;
      if (msg.type === 'dm_close') {
        window.dispatchEvent(
          new CustomEvent('dm-child-close', {
            detail: { conversationId: msg.conversationId },
          }),
        );
      }
    },
  );

  return () => {
    unsubscribe();
    if (unlistenPromise) {
      void unlistenPromise.then((fn) => {
        fn();
      });
      unlistenPromise = null;
    }
  };
}

/**
 * Create a virtual WsClient for child windows.
 * Implements the same WsClient interface but uses Tauri IPC events
 * instead of a real WebSocket connection.
 */
export function createIpcWsClient(): WsClient {
  let handlers = new Set<WsHandler>();
  let unlisten: UnlistenFn | null = null;
  let closed = false;
  let listening = false;

  // Start listening for server messages relayed from main window
  void listen<ServerMessage>(WS_SERVER_MESSAGE, (event: TauriEvent<ServerMessage>) => {
    if (closed) return;
    for (const handler of handlers) {
      handler(event.payload);
    }
  }).then((fn: UnlistenFn) => {
    if (closed) {
      fn();
    } else {
      unlisten = fn;
      listening = true;
    }
  });

  return {
    send(msg: ClientMessage) {
      if (closed) return;
      void emit(WS_CLIENT_MESSAGE, msg);
    },

    subscribe(handler: WsHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    close() {
      closed = true;
      handlers = new Set();
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    },

    isConnected() {
      // Child windows are "connected" as long as the IPC listener is active
      return listening && !closed;
    },
  };
}
