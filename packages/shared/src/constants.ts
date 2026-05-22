export const APP_VERSION = '0.0.1';
export const USER_AGENT = `protoimsg/${APP_VERSION} (+https://protoimsg.app)`;

/** atproto Lexicon NSIDs for protoimsg collections */
export const NSID = {
  Community: 'app.protoimsg.chat.community',
  AuthVerify: 'app.protoimsg.chat.authVerify',
} as const;

/** Namespace prefix for all protoimsg Lexicon records */
export const NSID_PREFIX = 'app.protoimsg.chat.';

/** Server limits */
export const LIMITS = {
  /** Maximum away message length */
  maxAwayMessageLength: 300,
  /** Maximum buddy list groups */
  maxBuddyGroups: 50,
  /** Maximum members per buddy group */
  maxGroupMembers: 500,
  /** Default message retention in days */
  defaultRetentionDays: 7,
  /** Maximum page size for paginated queries */
  maxPageSize: 200,
  /** Default page size for paginated queries */
  defaultPageSize: 50,
} as const;

/** Labelers enforced server-side and included in profile fetch headers. */
export const APP_LABELERS = [
  { did: 'did:plc:d2mkddsbmnrgr3domzg5qexf' }, // Blacksky
] as const;

/** Report categories for user report moderation flow */
export const REPORT_CATEGORIES = [
  'harassment',
  'spam',
  'impersonation',
  'hateSpeech',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** ProtoBuddy bot constants */
export const BOT = {
  id: '__protobuddy__',
  displayName: 'ProtoBuddy',
  maxCommandLength: 500,
} as const;

/** DM-specific limits */
export const DM_LIMITS = {
  /** Maximum DM message text length in characters */
  maxMessageLength: 3000,
  /** Maximum preview text length for dm_incoming notifications */
  maxPreviewLength: 100,
} as const;

/* -------------------------------------------------------------------------- */
/*  OAuth scopes — minimal set for a video meeting platform.                 */
/*  Only ATProto core + protoimsg chat collection access.                    */
/* -------------------------------------------------------------------------- */

export const OAUTH_SCOPE =
  'atproto include:app.protoimsg.chat.authFull repo:actor.rpg.stats repo:equipment.rpg.item';
