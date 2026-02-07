/**
 * @chatmosphere/lexicon
 *
 * ATProto Lexicon schemas and generated types for Chatmosphere chat protocol.
 *
 * The Lexicon JSON schemas live in ./schemas/ and define the protocol.
 * Generated TypeScript types will be placed in ./generated/ via the codegen script.
 *
 * For now, we export hand-written types matching the schemas.
 * Once lex-cli codegen is run, these will be replaced by generated exports.
 */

/** app.chatmosphere.chat.room record */
export interface RoomRecord {
  $type: 'app.chatmosphere.chat.room';
  name: string;
  description?: string;
  purpose: 'discussion' | 'event' | 'community' | 'support';
  createdAt: string;
  settings?: RoomSettings;
}

export interface RoomSettings {
  visibility?: 'public' | 'unlisted' | 'private';
  minAccountAgeDays?: number;
  slowModeSeconds?: number;
}

/** app.chatmosphere.chat.message record */
export interface MessageRecord {
  $type: 'app.chatmosphere.chat.message';
  room: string;
  text: string;
  facets?: RichTextFacet[];
  replyTo?: string;
  createdAt: string;
}

export interface RichTextFacet {
  index: ByteSlice;
  features: (MentionFeature | LinkFeature)[];
}

export interface ByteSlice {
  byteStart: number;
  byteEnd: number;
}

export interface MentionFeature {
  $type: 'app.chatmosphere.chat.message#mention';
  did: string;
}

export interface LinkFeature {
  $type: 'app.chatmosphere.chat.message#link';
  uri: string;
}

/** app.chatmosphere.chat.buddylist record */
export interface BuddyListRecord {
  $type: 'app.chatmosphere.chat.buddylist';
  groups: BuddyGroup[];
}

export interface BuddyGroup {
  name: string;
  isCloseFriends?: boolean;
  members: BuddyMember[];
}

export interface BuddyMember {
  did: string;
  addedAt: string;
}

/** app.chatmosphere.chat.presence record */
export interface PresenceRecord {
  $type: 'app.chatmosphere.chat.presence';
  status: 'online' | 'away' | 'idle' | 'offline' | 'invisible';
  visibleTo: 'everyone' | 'close-friends' | 'nobody';
  awayMessage?: string;
  updatedAt: string;
}

/** app.chatmosphere.chat.poll record */
export interface PollRecord {
  $type: 'app.chatmosphere.chat.poll';
  room: string;
  question: string;
  options: string[];
  allowMultiple?: boolean;
  expiresAt?: string;
  createdAt: string;
}

/** app.chatmosphere.chat.vote record */
export interface VoteRecord {
  $type: 'app.chatmosphere.chat.vote';
  poll: string;
  selectedOptions: number[];
  createdAt: string;
}

/** app.chatmosphere.chat.ban record */
export interface BanRecord {
  $type: 'app.chatmosphere.chat.ban';
  room: string;
  subject: string;
  reason?: string;
  createdAt: string;
}

/** app.chatmosphere.chat.role record */
export interface RoleRecord {
  $type: 'app.chatmosphere.chat.role';
  room: string;
  subject: string;
  role: 'moderator' | 'owner';
  createdAt: string;
}

/** Union of all Chatmosphere chat records */
export type ChatRecord =
  | RoomRecord
  | MessageRecord
  | BuddyListRecord
  | PresenceRecord
  | PollRecord
  | VoteRecord
  | BanRecord
  | RoleRecord;
