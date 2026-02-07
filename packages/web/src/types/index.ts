/** Client view models — mirror server DB rows for display */

export interface RoomView {
  id: string;
  uri: string;
  did: string;
  name: string;
  description: string | null;
  purpose: string;
  visibility: string;
  min_account_age_days: number;
  slow_mode_seconds: number;
  created_at: string;
  indexed_at: string;
}

export interface MessageView {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  text: string;
  reply_to: string | null;
  created_at: string;
  indexed_at: string;
  /** Client-only: true while waiting for WS confirmation */
  pending?: boolean;
}

export interface MemberPresence {
  did: string;
  status: string;
  awayMessage?: string;
}

export interface BuddyWithPresence {
  did: string;
  status: string;
  awayMessage?: string;
  addedAt: string;
  isCloseFriend?: boolean;
  isBlocked?: boolean;
}
