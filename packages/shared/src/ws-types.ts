/** WebSocket message types — shared contract between server and client */
import type { TownGate } from './town.js';

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

/**
 * Enter a scene (also re-sent on reconnect). `scene` is a `townSceneId`; the
 * server checks admission and answers `town_state` or `town_denied`. Missing
 * `scene` means your own home — fail closed, never somewhere public.
 */
export interface TownJoinMessage extends WsMessageBase {
  type: 'town_join';
  scene?: string;
  /** Friends-of-friends mode, applied before your first view is built. */
  fof?: boolean;
  x: number;
  y: number;
  dir: number;
}

export interface TownMoveMessage extends WsMessageBase {
  type: 'town_move';
  x: number;
  y: number;
  dir: number;
  /** Running (Space held) — others draw faster legs. */
  sprint?: boolean;
}

export interface TownChatMessage extends WsMessageBase {
  type: 'town_chat';
  text: string;
}

export interface TownLeaveMessage extends WsMessageBase {
  type: 'town_leave';
}

/**
 * Friends-of-friends mode (square only): while on, you see and are seen only
 * by people within two steps of you on the mutual graph.
 */
export interface TownFofMessage extends WsMessageBase {
  type: 'town_fof';
  on: boolean;
}

/**
 * Knock on the door of the neighborhood you're visiting. Only the owner's
 * inner circle can; the answer is `town_state` (let in) or
 * `town_knock_result` (no answer — the same for declined, away or anything
 * else, after the same wait).
 */
export interface TownKnockMessage extends WsMessageBase {
  type: 'town_knock';
}

/** The owner answers a knock (`town_knock_request`). */
export interface TownKnockAnswerMessage extends WsMessageBase {
  type: 'town_knock_answer';
  knockId: string;
  letIn: boolean;
}

/** The owner asks a guest to leave their home (they stay in the inner circle). */
export interface TownKickMessage extends WsMessageBase {
  type: 'town_kick';
  did: string;
}

/** The owner opens or closes their door to knocks. */
export interface TownKnockingMessage extends WsMessageBase {
  type: 'town_knocking';
  open: boolean;
}

/**
 * Ask to join the conversation you're standing next to (in a neighborhood),
 * when some of its people aren't your mutuals. They're asked; if all of them
 * agree you get temporary passes for as long as you stay in it.
 */
export interface TownJoinAskMessage extends WsMessageBase {
  type: 'town_join_ask';
}

/** Answer someone's request to join your conversation (`town_join_request`). */
export interface TownJoinAnswerMessage extends WsMessageBase {
  type: 'town_join_answer';
  requestId: string;
  accept: boolean;
}

/** Client lost (or never made) its voice connection — ask for a fresh token. */
export interface TownVoiceRefreshMessage extends WsMessageBase {
  type: 'town_voice_refresh';
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
  | TownLeaveMessage
  | TownVoiceRefreshMessage
  | TownFofMessage
  | TownKnockMessage
  | TownKnockAnswerMessage
  | TownKickMessage
  | TownKnockingMessage
  | TownJoinAskMessage
  | TownJoinAnswerMessage;

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
  sprint?: boolean;
}

export interface TownStateEvent extends WsMessageBase {
  type: 'town_state';
  /**
   * `voice` is false when the server has no LiveKit — no proximity audio.
   * `voiceUrl` lets the client warm up its LiveKit connection early.
   */
  data: {
    /** The scene you're now in (`townSceneId`). */
    scene: string;
    /** Your position, as the server placed it (clamped to the scene). */
    self: { x: number; y: number; dir: number };
    peers: TownPeer[];
    voice: boolean;
    voiceUrl?: string;
    /** Square only: the gate row, and owners beyond it (listed on the signpost). */
    gates?: TownGate[];
    moreGates?: string[];
    /**
     * Visiting someone's neighborhood: whether you may knock on their door
     * (you're in their inner circle).
     */
    canKnock?: boolean;
    /** Your own home: whether your door takes knocks (shared by all your tabs). */
    knockingOpen?: boolean;
    /**
     * Someone's neighborhood: whether their window glows — they're home, and
     * their own visibility setting already shows them online to you.
     */
    windowLit?: boolean;
    /**
     * Set when the server moved you without being asked: `removed` (the owner
     * took you off their list, or a block), `letIn` (your knock was answered),
     * `visitOver` (the owner asked you to leave, or left home themselves).
     */
    reason?: 'removed' | 'letIn' | 'visitOver';
  };
}

/** Someone is knocking on your door (you're home). */
export interface TownKnockRequestEvent extends WsMessageBase {
  type: 'town_knock_request';
  /** `again`: you said "not now" to them recently — they're back. */
  data: { knockId: string; from: string; again?: boolean };
}

/** A knock card can go: answered (maybe in another tab), withdrawn or expired. */
export interface TownKnockEndEvent extends WsMessageBase {
  type: 'town_knock_end';
  data: { knockId: string };
}

/** Your knock went unanswered (declined, away, or closed — indistinguishable). */
export interface TownKnockResultEvent extends WsMessageBase {
  type: 'town_knock_result';
  data: { outcome: 'noAnswer' };
}

/**
 * Whether "ask to join" applies right now: a conversation next to you has
 * people you can't see, and there's room for you. Server-computed — only it
 * knows who's in which conversation.
 */
export interface TownJoinAvailableEvent extends WsMessageBase {
  type: 'town_join_available';
  data: { available: boolean };
}

/** Someone you can't see would like to join your conversation. */
export interface TownJoinRequestEvent extends WsMessageBase {
  type: 'town_join_request';
  data: { requestId: string; from: string };
}

/** A join request card can go (answered elsewhere, withdrawn or expired). */
export interface TownJoinRequestEndEvent extends WsMessageBase {
  type: 'town_join_request_end';
  data: { requestId: string };
}

/**
 * How your request to join went: `accepted` (you'll be connected), or
 * `noAnswer` — declined, timed out or not possible look the same.
 */
export interface TownJoinResultEvent extends WsMessageBase {
  type: 'town_join_result';
  data: { outcome: 'accepted' | 'noAnswer' };
}

/** Whether you may knock here changed (the owner edited their inner circle). */
export interface TownKnockAccessEvent extends WsMessageBase {
  type: 'town_knock_access';
  data: { canKnock: boolean };
}

/** The window of the house you're outside started or stopped glowing. */
export interface TownWindowEvent extends WsMessageBase {
  type: 'town_window';
  data: { lit: boolean };
}

/** Your door was opened or closed to knocks (maybe from another tab). */
export interface TownDoorEvent extends WsMessageBase {
  type: 'town_door';
  data: { open: boolean };
}

/** Who's visiting your home right now (sent to you while you're home). */
export interface TownGuestsEvent extends WsMessageBase {
  type: 'town_guests';
  data: { guests: string[] };
}

/** Your gate row changed (someone added or removed you from their community). */
export interface TownGatesEvent extends WsMessageBase {
  type: 'town_gates';
  data: { gates: TownGate[]; moreGates: string[] };
}

/** You weren't let into `scene` — you stay where you were. */
export interface TownDeniedEvent extends WsMessageBase {
  type: 'town_denied';
  data: { scene: string };
}

/**
 * Batched changes to what you can see (sent at most every ~100ms): avatars
 * that appeared or moved within your view, and DIDs that left it (walked
 * out of view, went home, or left town). Replaces per-move broadcasts.
 */
export interface TownViewEvent extends WsMessageBase {
  type: 'town_view';
  data: { upsert: TownPeer[]; remove: string[] };
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

/** One avatar in your proximity cluster, with its anonymous LiveKit identity. */
export interface TownVoiceMember {
  did: string;
  /** LiveKit participant identity (random, carries no DID). */
  pid: string;
}

/**
 * Your proximity voice assignment. `room` is null when nobody is near you.
 * A same `roomId` + `selfPid` while connected is a roster refresh; anything
 * else means (re)connect with `token`. Clients must only grant track
 * subscriptions to `members` — the server reconciles stragglers out.
 */
export interface TownProximityEvent extends WsMessageBase {
  type: 'town_proximity';
  data: {
    room: {
      roomId: string;
      url: string;
      token: string;
      /** Your own LiveKit identity in this room. */
      selfPid: string;
      members: TownVoiceMember[];
    } | null;
  };
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
  | TownChatEvent
  | TownProximityEvent
  | TownDeniedEvent
  | TownGatesEvent
  | TownKnockRequestEvent
  | TownKnockEndEvent
  | TownKnockResultEvent
  | TownGuestsEvent
  | TownKnockAccessEvent
  | TownJoinAvailableEvent
  | TownJoinRequestEvent
  | TownJoinRequestEndEvent
  | TownJoinResultEvent
  | TownDoorEvent
  | TownWindowEvent
  | TownViewEvent;
