/** Client view models — mirror web client types */

export interface RoomView {
  id: string;
  uri: string;
  did: string;
  name: string;
  description: string | null;
  topic: string;
  purpose: string;
  category: string | null;
  visibility: string;
  min_account_age_days: number;
  slow_mode_seconds: number;
  created_at: string;
  indexed_at: string;
}

export interface MemberPresence {
  did: string;
  status: string;
  awayMessage?: string;
}

export interface MemberWithPresence {
  did: string;
  status: string;
  awayMessage?: string;
  addedAt: string;
  isInnerCircle?: boolean;
  blockRkey?: string;
}

export interface ChannelView {
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

export interface MessageView {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  channel_id: string;
  text: string;
  reply_parent: string | null;
  reply_root: string | null;
  facets?: unknown[];
  embed?: unknown;
  created_at: string;
  indexed_at: string;
  pending?: boolean;
}

export type DoorEvent = 'join' | 'leave';

export interface DmMessageView {
  id: string;
  conversationId: string;
  senderDid: string;
  text: string;
  createdAt: string;
  pending?: boolean;
  facets?: unknown[];
  embed?: unknown;
}

export type DataChannelState = 'connecting' | 'open' | 'closed' | 'failed';

export interface DmConversation {
  conversationId: string;
  recipientDid: string;
  messages: DmMessageView[];
  typing: boolean;
  peerState: DataChannelState;
  closingIn: number | null;
}

export interface PollView {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  channel_id: string;
  question: string;
  options: string[];
  allow_multiple: boolean;
  expires_at: string | null;
  created_at: string;
  indexed_at: string;
  tallies: Record<number, number>;
  totalVoters: number;
  myVote: number[] | null;
  pending?: boolean;
}

export type TimelineItem = (MessageView & { _type: 'message' }) | (PollView & { _type: 'poll' });

export interface DmNotification {
  conversationId: string;
  senderDid: string;
  receivedAt: string;
}
