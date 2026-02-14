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

export interface RequestCommunityPresenceMessage extends WsMessageBase {
  type: 'request_community_presence';
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

export interface RoomTypingMessage extends WsMessageBase {
  type: 'room_typing';
  roomId: string;
}

export interface SyncBlocksMessage extends WsMessageBase {
  type: 'sync_blocks';
  blockedDids: string[];
}

export interface SyncCommunityMessage extends WsMessageBase {
  type: 'sync_community';
  groups: Array<{
    name: string;
    isInnerCircle?: boolean;
    members: Array<{ did: string; addedAt: string }>;
  }>;
}

export type ClientMessage =
  | AuthMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | StatusChangeMessage
  | PingMessage
  | RequestCommunityPresenceMessage
  | RoomTypingMessage
  | SyncBlocksMessage
  | SyncCommunityMessage
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
    reply?: { root: string; parent: string };
    facets?: unknown[];
    embed?: unknown;
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

export interface CommunityPresenceEvent extends WsMessageBase {
  type: 'community_presence';
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
  errorCode?: string;
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

export interface MentionNotificationEvent extends WsMessageBase {
  type: 'mention_notification';
  data: {
    roomId: string;
    roomName: string;
    senderDid: string;
    messageText: string;
    messageUri: string;
    createdAt: string;
  };
}

export interface AuthSuccessEvent extends WsMessageBase {
  type: 'auth_success';
}

export interface RoomTypingEvent extends WsMessageBase {
  type: 'room_typing';
  data: {
    roomId: string;
    did: string;
  };
}

export type ServerMessage =
  | AuthSuccessEvent
  | NewMessageEvent
  | PresenceUpdateEvent
  | CommunityPresenceEvent
  | RoomJoinedEvent
  | PongEvent
  | ErrorEvent
  | RoomTypingEvent
  | DmOpenedEvent
  | DmMessageEvent
  | DmTypingEvent
  | DmPersistChangedEvent
  | DmIncomingEvent
  | MentionNotificationEvent;
