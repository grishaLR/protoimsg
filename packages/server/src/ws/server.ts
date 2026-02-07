import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { RoomSubscriptions } from './rooms.js';
import { handleClientMessage } from './handlers.js';
import { handleUserConnect, handleUserDisconnect } from '../presence/service.js';
import type { ClientMessage, ServerMessage } from './types.js';

export interface WsServer {
  broadcastToRoom: (roomId: string, message: ServerMessage) => void;
  close: () => void;
}

export function createWsServer(httpServer: Server): WsServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const roomSubs = new RoomSubscriptions();

  wss.on('connection', (ws: WebSocket) => {
    // For now, DID is sent as first message or query param
    // Real auth will use ATProto OAuth session validation
    let did: string | null = null;

    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString('utf-8')) as ClientMessage & { did?: string };

        // First message must include DID (temporary — will use OAuth session)
        if (!did) {
          if ('did' in data && typeof data.did === 'string') {
            did = data.did;
            handleUserConnect(did);
            console.log(`WS connected: ${did}`);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'First message must include did' }));
            return;
          }
        }

        handleClientMessage(ws, did, data, roomSubs);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      if (did) {
        handleUserDisconnect(did);
        roomSubs.unsubscribeAll(ws);
        console.log(`WS disconnected: ${did}`);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  return {
    broadcastToRoom: (roomId: string, message: ServerMessage) => {
      roomSubs.broadcast(roomId, message);
    },
    close: () => {
      wss.close();
    },
  };
}
