/** Client view models — mirror server DB rows for display */

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
  allowlist_enabled: boolean;
  created_at: string;
  indexed_at: string;
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
  /** Client-only: true while waiting for WS confirmation */
  pending?: boolean;
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
  /** Vote tallies: option index → count */
  tallies: Record<number, number>;
  totalVoters: number;
  /** Current user's vote (null if not voted) */
  myVote: number[] | null;
  /** Client-only: true while waiting for WS confirmation */
  pending?: boolean;
}

/** Discriminated union for timeline items (messages + polls) */
export type TimelineItem = (MessageView & { _type: 'message' }) | (PollView & { _type: 'poll' });

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
  /** atproto block record key — needed for deletion on unblock */
  blockRkey?: string;
}

export type CommunityListRow =
  | {
      type: 'group-header';
      groupName: string;
      onlineCount: number;
      totalCount: number;
      isCollapsed: boolean;
    }
  | { type: 'buddy'; buddy: MemberWithPresence; groupName: string };

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

export interface FeedInfo {
  uri: string | undefined; // undefined = Following timeline
  displayName: string;
}
