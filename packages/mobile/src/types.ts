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

export type DoorEvent = 'join' | 'leave';
