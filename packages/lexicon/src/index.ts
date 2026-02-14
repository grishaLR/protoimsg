/**
 * @protoimsg/lexicon
 *
 * atproto Lexicon schemas and generated types for protoimsg chat protocol.
 *
 * The Lexicon JSON schemas live in ./schemas/ and define the protocol.
 * Generated TypeScript types will be placed in ./generated/ via the codegen script.
 *
 * For now, we export hand-written types matching the schemas.
 * Once lex-cli codegen is run, these will be replaced by generated exports.
 */

/** app.protoimsg.chat.room record */
export interface RoomRecord {
  $type: 'app.protoimsg.chat.room';
  name: string;
  topic: string;
  description?: string;
  purpose: 'discussion' | 'event' | 'community' | 'support';
  createdAt: string;
  settings?: RoomSettings;
}

export interface RoomSettings {
  visibility?: 'public' | 'unlisted' | 'private';
  minAccountAgeDays?: number;
  slowModeSeconds?: number;
  allowlistEnabled?: boolean;
}

/** app.protoimsg.chat.message record */
export interface MessageRecord {
  $type: 'app.protoimsg.chat.message';
  room: string;
  text: string;
  facets?: RichTextFacet[];
  reply?: ReplyRef;
  embed?: ImageEmbed | VideoEmbed | ExternalEmbed;
  createdAt: string;
}

export interface ReplyRef {
  root: string;
  parent: string;
}

export interface ImageEmbed {
  $type: 'app.protoimsg.chat.message#imageEmbed';
  images: ImageItem[];
}

export interface ImageItem {
  image: BlobRef;
  alt: string;
  aspectRatio?: AspectRatio;
}

export interface VideoEmbed {
  $type: 'app.protoimsg.chat.message#videoEmbed';
  video: BlobRef;
  alt?: string;
  thumbnail?: BlobRef;
  aspectRatio?: AspectRatio;
}

export interface ExternalEmbed {
  $type: 'app.protoimsg.chat.message#externalEmbed';
  uri: string;
  title: string;
  description?: string;
  thumb?: BlobRef;
}

export interface AspectRatio {
  width: number;
  height: number;
}

/** ATProto blob reference */
export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface RichTextFacet {
  index: ByteSlice;
  features: (MentionFeature | LinkFeature | TagFeature | FormattingFeature)[];
}

export interface ByteSlice {
  byteStart: number;
  byteEnd: number;
}

export interface MentionFeature {
  $type: 'app.protoimsg.chat.message#mention';
  did: string;
}

export interface LinkFeature {
  $type: 'app.protoimsg.chat.message#link';
  uri: string;
}

export interface TagFeature {
  $type: 'app.protoimsg.chat.message#tag';
  tag: string;
}

export interface BoldFeature {
  $type: 'app.protoimsg.chat.message#bold';
}

export interface ItalicFeature {
  $type: 'app.protoimsg.chat.message#italic';
}

export interface StrikethroughFeature {
  $type: 'app.protoimsg.chat.message#strikethrough';
}

export interface CodeInlineFeature {
  $type: 'app.protoimsg.chat.message#codeInline';
}

export interface CodeBlockFeature {
  $type: 'app.protoimsg.chat.message#codeBlock';
}

export interface BlockquoteFeature {
  $type: 'app.protoimsg.chat.message#blockquote';
}

export type FormattingFeature =
  | BoldFeature
  | ItalicFeature
  | StrikethroughFeature
  | CodeInlineFeature
  | CodeBlockFeature
  | BlockquoteFeature;

/** app.protoimsg.chat.community record */
export interface CommunityRecord {
  $type: 'app.protoimsg.chat.community';
  groups: CommunityGroup[];
}

export interface CommunityGroup {
  name: string;
  isInnerCircle?: boolean;
  members: CommunityMember[];
}

export interface CommunityMember {
  did: string;
  addedAt: string;
}

/** app.protoimsg.chat.presence record */
export interface PresenceRecord {
  $type: 'app.protoimsg.chat.presence';
  status: 'online' | 'away' | 'idle' | 'offline' | 'invisible';
  visibleTo: 'everyone' | 'community' | 'inner-circle' | 'no-one';
  awayMessage?: string;
  updatedAt: string;
}

/** app.protoimsg.chat.poll record */
export interface PollRecord {
  $type: 'app.protoimsg.chat.poll';
  room: string;
  question: string;
  options: string[];
  allowMultiple?: boolean;
  expiresAt?: string;
  createdAt: string;
}

/** app.protoimsg.chat.vote record */
export interface VoteRecord {
  $type: 'app.protoimsg.chat.vote';
  poll: string;
  selectedOptions: number[];
  createdAt: string;
}

/** app.protoimsg.chat.ban record */
export interface BanRecord {
  $type: 'app.protoimsg.chat.ban';
  room: string;
  subject: string;
  reason?: string;
  createdAt: string;
}

/** app.protoimsg.chat.role record */
export interface RoleRecord {
  $type: 'app.protoimsg.chat.role';
  room: string;
  subject: string;
  role: 'moderator' | 'owner';
  createdAt: string;
}

/** app.protoimsg.chat.allowlist record */
export interface AllowlistRecord {
  $type: 'app.protoimsg.chat.allowlist';
  room: string;
  subject: string;
  createdAt: string;
}

/** Union of all protoimsg chat records */
export type ChatRecord =
  | RoomRecord
  | MessageRecord
  | CommunityRecord
  | PresenceRecord
  | PollRecord
  | VoteRecord
  | BanRecord
  | RoleRecord
  | AllowlistRecord;
