import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { RoomSubscriptions } from './rooms.js';
import { BuddyWatchers } from './buddy-watchers.js';
import { handleClientMessage } from './handlers.js';
import type { PresenceService } from '../presence/service.js';
import type { ClientMessage, ServerMessage } from './types.js';
import type { Sql } from '../db/client.js';

export interface WsServer {
  broadcastToRoom: (roomId: string, message: ServerMessage) => void;
  close: () => void;
}

export function createWsServer(httpServer: Server, sql: Sql, service: PresenceService): WsServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const roomSubs = new RoomSubscriptions();
  const buddyWatchers = new BuddyWatchers(sql);

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
            service.handleUserConnect(did);
            buddyWatchers.notify(did, 'online');
            console.log(`WS connected: ${did}`);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'First message must include did' }));
            return;
          }
        }

        handleClientMessage(ws, did, data, roomSubs, buddyWatchers, service);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      if (did) {
        // Broadcast offline to every room before unsubscribing
        const rooms = service.getUserRooms(did);
        for (const roomId of rooms) {
          service.handleLeaveRoom(did, roomId);
          roomSubs.broadcast(roomId, {
            type: 'presence',
            data: { did, status: 'offline' },
          });
        }
        // Notify anyone watching this DID's buddy presence
        buddyWatchers.notify(did, 'offline');
        service.handleUserDisconnect(did);
        roomSubs.unsubscribeAll(ws);
        buddyWatchers.unwatchAll(ws);
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
