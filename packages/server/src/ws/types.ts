// Re-export WS types from shared package — canonical source is @chatmosphere/shared
export type {
  WsMessageBase,
  JoinRoomMessage,
  LeaveRoomMessage,
  StatusChangeMessage,
  PingMessage,
  ClientMessage,
  NewMessageEvent,
  PresenceUpdateEvent,
  RoomJoinedEvent,
  PongEvent,
  ErrorEvent,
  ServerMessage,
} from '@chatmosphere/shared';
