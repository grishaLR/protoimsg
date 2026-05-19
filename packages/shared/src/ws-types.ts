/** WebSocket message types — shared contract between server and client */

/** Portable ICE candidate — mirrors browser RTCIceCandidateInit without DOM dep */
export interface IceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** ICE server config returned by /api/ice-servers (subset of RTCIceServer) */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface WsMessageBase {
  type: string;
}

// Client → Server messages

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

export interface DmRejectMessage extends WsMessageBase {
  type: 'dm_reject';
  conversationId: string;
}

// IM signaling (P2P data channels — separate from video call signaling)

export interface ImOfferMessage extends WsMessageBase {
  type: 'im_offer';
  conversationId: string;
  offer: string;
}

export interface ImAnswerMessage extends WsMessageBase {
  type: 'im_answer';
  conversationId: string;
  answer: string;
}

export interface ImIceCandidateMessage extends WsMessageBase {
  type: 'im_ice_candidate';
  conversationId: string;
  candidate: IceCandidateInit;
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

export interface CallInitMessage extends WsMessageBase {
  type: 'call_init';
  recipientDid: string;
}

export interface MakeCallMessage extends WsMessageBase {
  type: 'make_call';
  conversationId: string;
  offer: string;
}

export interface AcceptCallMessage extends WsMessageBase {
  type: 'accept_call';
  conversationId: string;
  answer: string;
}

export interface RejectCallMessage extends WsMessageBase {
  type: 'reject_call';
  conversationId: string;
}

export interface NewIceCandidateMessage extends WsMessageBase {
  type: 'new_ice_candidate';
  conversationId: string;
  candidate: IceCandidateInit;
}

// Bot Client → Server messages

export interface BotDmOpenMessage extends WsMessageBase {
  type: 'bot_dm_open';
}

export interface BotDmSendMessage extends WsMessageBase {
  type: 'bot_dm_send';
  text: string;
}

export interface BotDmCloseMessage extends WsMessageBase {
  type: 'bot_dm_close';
}

// Group call Client → Server messages

export interface GroupCallCreateStandaloneMessage extends WsMessageBase {
  type: 'group_call_create_standalone';
  access?: 'anyone' | 'community' | 'inner-circle' | 'allowlist';
  allowedDids?: string[];
}

export interface GroupCallJoinByCodeMessage extends WsMessageBase {
  type: 'group_call_join_by_code';
  meetCode: string;
}

export interface GroupCallJoinMessage extends WsMessageBase {
  type: 'group_call_join';
  callId: string;
}

export interface GroupCallLeaveMessage extends WsMessageBase {
  type: 'group_call_leave';
  callId: string;
}

// Town (spatial world) Client → Server messages

export interface TownJoinMessage extends WsMessageBase {
  type: 'town_join';
  x: number;
  y: number;
  dir: number;
}

export interface TownMoveMessage extends WsMessageBase {
  type: 'town_move';
  x: number;
  y: number;
  dir: number;
}

export interface TownChatMessage extends WsMessageBase {
  type: 'town_chat';
  text: string;
}

export interface TownLeaveMessage extends WsMessageBase {
  type: 'town_leave';
}

export type ClientMessage =
  | AuthMessage
  | StatusChangeMessage
  | PingMessage
  | RequestCommunityPresenceMessage
  | SyncBlocksMessage
  | SyncCommunityMessage
  | DmOpenMessage
  | DmCloseMessage
  | DmRejectMessage
  | ImOfferMessage
  | ImAnswerMessage
  | ImIceCandidateMessage
  | CallInitMessage
  | MakeCallMessage
  | AcceptCallMessage
  | RejectCallMessage
  | NewIceCandidateMessage
  | BotDmOpenMessage
  | BotDmSendMessage
  | BotDmCloseMessage
  | GroupCallCreateStandaloneMessage
  | GroupCallJoinMessage
  | GroupCallJoinByCodeMessage
  | GroupCallLeaveMessage
  | TownJoinMessage
  | TownMoveMessage
  | TownChatMessage
  | TownLeaveMessage;

// Server → Client messages

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
  };
}

export interface DmPartnerLeftEvent extends WsMessageBase {
  type: 'dm_partner_left';
  data: {
    conversationId: string;
  };
}

export interface DmRejectedEvent extends WsMessageBase {
  type: 'dm_rejected';
  data: {
    conversationId: string;
  };
}

// IM signaling Server → Client events

export interface ImOfferEvent extends WsMessageBase {
  type: 'im_offer';
  data: {
    conversationId: string;
    senderDid: string;
    offer: string;
  };
}

export interface ImAnswerEvent extends WsMessageBase {
  type: 'im_answer';
  data: {
    conversationId: string;
    answer: string;
  };
}

export interface ImIceCandidateEvent extends WsMessageBase {
  type: 'im_ice_candidate';
  data: {
    conversationId: string;
    candidate: IceCandidateInit;
  };
}

export interface CallReadyEvent extends WsMessageBase {
  type: 'call_ready';
  data: {
    conversationId: string;
    recipientDid: string;
  };
}

export interface AcceptCallEvent extends WsMessageBase {
  type: 'accept_call';
  data: {
    conversationId: string;
    answer: string;
  };
}

export interface RejectCallEvent extends WsMessageBase {
  type: 'reject_call';
  data: {
    conversationId: string;
  };
}

export interface IncomingCallEvent extends WsMessageBase {
  type: 'incoming_call';
  data: {
    conversationId: string;
    senderDid: string;
    offer: string;
  };
}

export interface NewIceCandidateEvent extends WsMessageBase {
  type: 'new_ice_candidate';
  data: {
    conversationId: string;
    candidate: IceCandidateInit;
  };
}

export interface AuthSuccessEvent extends WsMessageBase {
  type: 'auth_success';
}

// Bot Server → Client events

export interface BotDmResponseEvent extends WsMessageBase {
  type: 'bot_dm_response';
  data: {
    text: string;
    i18nKey?: string;
    createdAt: string;
  };
}

// Group call Server → Client events

export interface GroupCallTokenEvent extends WsMessageBase {
  type: 'group_call_token';
  data: {
    callId: string;
    token: string;
    url: string;
    meetCode: string | null;
  };
}

export interface GroupCallErrorEvent extends WsMessageBase {
  type: 'group_call_error';
  data: {
    message: string;
    errorCode?: string;
  };
}

// Town (spatial world) Server → Client events

export interface TownPeer {
  did: string;
  x: number;
  y: number;
  dir: number;
}

export interface TownStateEvent extends WsMessageBase {
  type: 'town_state';
  data: { peers: TownPeer[] };
}

export interface TownPeerJoinEvent extends WsMessageBase {
  type: 'town_peer_join';
  data: TownPeer;
}

export interface TownPeerMoveEvent extends WsMessageBase {
  type: 'town_peer_move';
  data: TownPeer;
}

export interface TownPeerLeaveEvent extends WsMessageBase {
  type: 'town_peer_leave';
  data: { did: string };
}

export interface TownChatEvent extends WsMessageBase {
  type: 'town_chat';
  data: { did: string; text: string };
}

export type ServerMessage =
  | AuthSuccessEvent
  | PresenceUpdateEvent
  | CommunityPresenceEvent
  | PongEvent
  | ErrorEvent
  | DmOpenedEvent
  | DmPartnerLeftEvent
  | DmRejectedEvent
  | ImOfferEvent
  | ImAnswerEvent
  | ImIceCandidateEvent
  | CallReadyEvent
  | IncomingCallEvent
  | RejectCallEvent
  | AcceptCallEvent
  | NewIceCandidateEvent
  | BotDmResponseEvent
  | GroupCallTokenEvent
  | GroupCallErrorEvent
  | TownStateEvent
  | TownPeerJoinEvent
  | TownPeerMoveEvent
  | TownPeerLeaveEvent
  | TownChatEvent;
