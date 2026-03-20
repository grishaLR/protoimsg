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

export interface BotRoomCommandMessage extends WsMessageBase {
  type: 'bot_room_command';
  text: string;
  roomId: string;
  channelId: string;
}

// Group call Client → Server messages

export interface GroupCallCreateMessage extends WsMessageBase {
  type: 'group_call_create';
  roomId: string;
}

export interface GroupCallCreateStandaloneMessage extends WsMessageBase {
  type: 'group_call_create_standalone';
  /** Who can join: 'anyone' (default), 'community' (buddy list), 'inner-circle', or 'allowlist'. */
  access?: 'anyone' | 'community' | 'inner-circle' | 'allowlist';
  /** Specific DIDs allowed to join (only used when access='allowlist'). */
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
  | NotifyRecordMessage
  | BotDmOpenMessage
  | BotDmSendMessage
  | BotDmCloseMessage
  | BotRoomCommandMessage
  | GroupCallCreateMessage
  | GroupCallCreateStandaloneMessage
  | GroupCallJoinMessage
  | GroupCallJoinByCodeMessage
  | GroupCallLeaveMessage;

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

export interface RoomRoleInfo {
  did: string;
  role: 'owner' | 'moderator';
}

export interface RoomJoinedEvent extends WsMessageBase {
  type: 'room_joined';
  roomId: string;
  members: string[];
  channels: ChannelInfo[];
  roles: RoomRoleInfo[];
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

export interface RoomBanEvent extends WsMessageBase {
  type: 'room_ban';
  data: {
    roomId: string;
    subjectDid: string;
    actorDid: string;
    action: 'ban' | 'unban';
  };
}

export interface RoomRoleUpdateEvent extends WsMessageBase {
  type: 'room_role_update';
  data: {
    roomId: string;
    subjectDid: string;
    role: 'owner' | 'moderator';
    action: 'add' | 'remove';
  };
}

// Bot Server → Client events

export interface BotDmResponseEvent extends WsMessageBase {
  type: 'bot_dm_response';
  data: {
    text: string;
    createdAt: string;
  };
}

export interface SystemMessageEvent extends WsMessageBase {
  type: 'system_message';
  data: {
    text: string;
    roomId: string;
    channelId: string;
    createdAt: string;
  };
}

// Group call Server → Client events

export interface GroupCallStartedEvent extends WsMessageBase {
  type: 'group_call_started';
  data: {
    callId: string;
    roomId: string;
    participantCount: number;
  };
}

export interface GroupCallEndedEvent extends WsMessageBase {
  type: 'group_call_ended';
  data: {
    callId: string;
    roomId: string;
  };
}

export interface GroupCallTokenEvent extends WsMessageBase {
  type: 'group_call_token';
  data: {
    callId: string;
    token: string;
    url: string;
    /** Short shareable code for standalone meetings, null for room-attached calls. */
    meetCode: string | null;
  };
}

export interface GroupCallParticipantJoinedEvent extends WsMessageBase {
  type: 'group_call_participant_joined';
  data: {
    callId: string;
    roomId: string;
    participantCount: number;
  };
}

export interface GroupCallParticipantLeftEvent extends WsMessageBase {
  type: 'group_call_participant_left';
  data: {
    callId: string;
    roomId: string;
    participantCount: number;
  };
}

export interface GroupCallErrorEvent extends WsMessageBase {
  type: 'group_call_error';
  data: {
    message: string;
    errorCode?: string;
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
  | NewIceCandidateEvent
  | RoomBanEvent
  | RoomRoleUpdateEvent
  | BotDmResponseEvent
  | SystemMessageEvent
  | GroupCallStartedEvent
  | GroupCallEndedEvent
  | GroupCallTokenEvent
  | GroupCallParticipantJoinedEvent
  | GroupCallParticipantLeftEvent
  | GroupCallErrorEvent;
