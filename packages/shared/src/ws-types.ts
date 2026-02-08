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

export interface AuthMessage extends WsMessageBase {
  type: 'auth';
  token: string;
}

// DM Client → Server messages

export interface DmOpenMessage extends WsMessageBase {
  type: 'dm_open';
  recipientDid: string;
}

export interface DmCloseMessage extends WsMessageBase {
  type: 'dm_close';
  conversationId: string;
}

export interface DmSendMessage extends WsMessageBase {
  type: 'dm_send';
  conversationId: string;
  text: string;
}

export interface DmTypingMessage extends WsMessageBase {
  type: 'dm_typing';
  conversationId: string;
}

export interface DmTogglePersistMessage extends WsMessageBase {
  type: 'dm_toggle_persist';
  conversationId: string;
  persist: boolean;
}

export type ClientMessage =
  | AuthMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | StatusChangeMessage
  | PingMessage
  | RequestBuddyPresenceMessage
  | DmOpenMessage
  | DmCloseMessage
  | DmSendMessage
  | DmTypingMessage
  | DmTogglePersistMessage;

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

// DM Server → Client events

export interface DmOpenedEvent extends WsMessageBase {
  type: 'dm_opened';
  data: {
    conversationId: string;
    recipientDid: string;
    persist: boolean;
    messages: Array<{
      id: string;
      conversationId: string;
      senderDid: string;
      text: string;
      createdAt: string;
    }>;
  };
}

export interface DmMessageEvent extends WsMessageBase {
  type: 'dm_message';
  data: {
    id: string;
    conversationId: string;
    senderDid: string;
    text: string;
    createdAt: string;
  };
}

export interface DmTypingEvent extends WsMessageBase {
  type: 'dm_typing';
  data: {
    conversationId: string;
    senderDid: string;
  };
}

export interface DmPersistChangedEvent extends WsMessageBase {
  type: 'dm_persist_changed';
  data: {
    conversationId: string;
    persist: boolean;
    changedBy: string;
  };
}

export interface DmIncomingEvent extends WsMessageBase {
  type: 'dm_incoming';
  data: {
    conversationId: string;
    senderDid: string;
    preview: string;
  };
}

export type ServerMessage =
  | NewMessageEvent
  | PresenceUpdateEvent
  | BuddyPresenceEvent
  | RoomJoinedEvent
  | PongEvent
  | ErrorEvent
  | DmOpenedEvent
  | DmMessageEvent
  | DmTypingEvent
  | DmPersistChangedEvent
  | DmIncomingEvent;
