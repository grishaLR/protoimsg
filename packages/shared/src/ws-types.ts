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

export interface ChannelTypingMessage extends WsMessageBase {
  type: 'channel_typing';
  roomId: string;
  channelId: string;
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

export interface NotifyRecordMessage extends WsMessageBase {
  type: 'notify_record';
  uri: string;
  cid: string;
}

export type ClientMessage =
  | AuthMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | StatusChangeMessage
  | PingMessage
  | RequestCommunityPresenceMessage
  | ChannelTypingMessage
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
  | NotifyRecordMessage;

// Server → Client messages

export interface NewMessageEvent extends WsMessageBase {
  type: 'message';
  data: {
    id: string;
    uri: string;
    did: string;
    roomId: string;
    channelId: string;
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

export interface ChannelInfo {
  id: string;
  uri: string;
  did: string;
  roomId: string;
  name: string;
  description: string | null;
  position: number;
  postPolicy: string;
  isDefault: boolean;
  createdAt: string;
}

export interface RoomJoinedEvent extends WsMessageBase {
  type: 'room_joined';
  roomId: string;
  members: string[];
  channels: ChannelInfo[];
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

export interface MentionNotificationEvent extends WsMessageBase {
  type: 'mention_notification';
  data: {
    roomId: string;
    roomName: string;
    channelId: string;
    channelName: string;
    senderDid: string;
    messageText: string;
    messageUri: string;
    createdAt: string;
  };
}

export interface PollCreatedEvent extends WsMessageBase {
  type: 'poll_created';
  data: {
    id: string;
    uri: string;
    did: string;
    roomId: string;
    channelId: string;
    question: string;
    options: string[];
    allowMultiple: boolean;
    expiresAt?: string;
    createdAt: string;
  };
}

export interface PollVoteEvent extends WsMessageBase {
  type: 'poll_vote';
  data: {
    pollId: string;
    roomId: string;
    channelId: string;
    /** Updated tallies: option index → count */
    tallies: Record<number, number>;
    /** Total unique voters */
    totalVoters: number;
    /** The voter's DID */
    voterDid: string;
    /** Which options they picked */
    selectedOptions: number[];
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

export interface ChannelTypingEvent extends WsMessageBase {
  type: 'channel_typing';
  data: {
    roomId: string;
    channelId: string;
    did: string;
  };
}

export interface ChannelCreatedEvent extends WsMessageBase {
  type: 'channel_created';
  data: ChannelInfo;
}

export interface ChannelDeletedEvent extends WsMessageBase {
  type: 'channel_deleted';
  data: {
    channelId: string;
    roomId: string;
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
  | ChannelTypingEvent
  | ChannelCreatedEvent
  | ChannelDeletedEvent
  | DmOpenedEvent
  | DmPartnerLeftEvent
  | DmRejectedEvent
  | ImOfferEvent
  | ImAnswerEvent
  | ImIceCandidateEvent
  | MentionNotificationEvent
  | PollCreatedEvent
  | PollVoteEvent
  | CallReadyEvent
  | IncomingCallEvent
  | RejectCallEvent
  | AcceptCallEvent
  | NewIceCandidateEvent;
