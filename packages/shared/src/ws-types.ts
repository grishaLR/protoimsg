/** WebSocket message types — shared contract between server and client */

export interface WsMessageBase {
  type: string;
}

// Client → Server messages

export interface JoinRoomMessage extends WsMessageBase {
  type: 'join_room';
  roomId: string;
}

export interface LeaveRoomMessage extends WsMessageBase {
  type: 'leave_room';
  roomId: string;
}

export interface StatusChangeMessage extends WsMessageBase {
  type: 'status_change';
  status: 'online' | 'away' | 'idle';
  awayMessage?: string;
  visibleTo?: string;
}

export interface PingMessage extends WsMessageBase {
  type: 'ping';
}

export interface RequestBuddyPresenceMessage extends WsMessageBase {
  type: 'request_buddy_presence';
  dids: string[];
}

export type ClientMessage =
  | JoinRoomMessage
  | LeaveRoomMessage
  | StatusChangeMessage
  | PingMessage
  | RequestBuddyPresenceMessage;

// Server → Client messages

export interface NewMessageEvent extends WsMessageBase {
  type: 'message';
  data: {
    id: string;
    uri: string;
    did: string;
    roomId: string;
    text: string;
    replyTo?: string;
    createdAt: string;
  };
}

export interface PresenceUpdateEvent extends WsMessageBase {
  type: 'presence';
  data: {
    did: string;
    status: string;
    awayMessage?: string;
  };
}

export interface BuddyPresenceEvent extends WsMessageBase {
  type: 'buddy_presence';
  data: Array<{
    did: string;
    status: string;
    awayMessage?: string;
  }>;
}

export interface RoomJoinedEvent extends WsMessageBase {
  type: 'room_joined';
  roomId: string;
  members: string[];
}

export interface PongEvent extends WsMessageBase {
  type: 'pong';
}

export interface ErrorEvent extends WsMessageBase {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | NewMessageEvent
  | PresenceUpdateEvent
  | BuddyPresenceEvent
  | RoomJoinedEvent
  | PongEvent
  | ErrorEvent;
