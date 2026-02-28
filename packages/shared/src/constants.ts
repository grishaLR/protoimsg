/** atproto Lexicon NSIDs for protoimsg collections */
export const NSID = {
  Room: 'app.protoimsg.chat.room',
  Channel: 'app.protoimsg.chat.channel',
  Message: 'app.protoimsg.chat.message',
  Community: 'app.protoimsg.chat.community',
  Presence: 'app.protoimsg.chat.presence',
  Poll: 'app.protoimsg.chat.poll',
  Vote: 'app.protoimsg.chat.vote',
  Ban: 'app.protoimsg.chat.ban',
  Role: 'app.protoimsg.chat.role',
  Allowlist: 'app.protoimsg.chat.allowlist',
  AuthVerify: 'app.protoimsg.chat.authVerify',
} as const;

/** Namespace prefix for all protoimsg Lexicon records */
export const NSID_PREFIX = 'app.protoimsg.chat.';

/** Default room settings */
export const ROOM_DEFAULTS = {
  visibility: 'public' as const,
  purpose: 'discussion' as const,
  minAccountAgeDays: 0,
  slowModeSeconds: 0,
};

/** Server limits */
export const LIMITS = {
  /** Maximum message text length in characters */
  maxMessageLength: 3000,
  /** Maximum room name length */
  maxRoomNameLength: 100,
  /** Maximum room topic length */
  maxRoomTopicLength: 200,
  /** Maximum room description length */
  maxRoomDescriptionLength: 500,
  /** Maximum room category length */
  maxRoomCategoryLength: 50,
  /** Maximum away message length */
  maxAwayMessageLength: 300,
  /** Maximum channel name length */
  maxChannelNameLength: 100,
  /** Maximum channel description length */
  maxChannelDescriptionLength: 500,
  /** Maximum channels per room */
  maxChannelsPerRoom: 50,
  /** Maximum poll options */
  maxPollOptions: 10,
  /** Maximum poll question length */
  maxPollQuestionLength: 200,
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

/** DM-specific limits */
export const DM_LIMITS = {
  /** Maximum DM message text length in characters */
  maxMessageLength: 3000,
  /** Maximum preview text length for dm_incoming notifications */
  maxPreviewLength: 100,
} as const;

/* -------------------------------------------------------------------------- */
/*  OAuth scope groups — collection-scoped permissions replacing              */
/*  transition:generic. Keep in sync with client-metadata JSON files.         */
/* -------------------------------------------------------------------------- */

const BSKY_AUD = 'did:web:api.bsky.app%23bsky_appview';
const rpc = (method: string) => `rpc:${method}?aud=${BSKY_AUD}`;

export const OAUTH_SCOPE_GROUPS = {
  core: ['atproto'],
  /** Permission-set bundles all app.protoimsg.chat.* repo scopes into one include: */
  chat: ['include:app.protoimsg.chat.authFull'],
  /** app.bsky scopes stay granular — namespace authority prevents bundling cross-namespace */
  socialGraph: [
    'repo:app.bsky.graph.block',
    rpc('app.bsky.graph.getBlocks'),
    rpc('app.bsky.graph.getMutes'),
    rpc('app.bsky.graph.getFollowers'),
    rpc('app.bsky.graph.getFollows'),
    rpc('app.bsky.graph.getRelationships'),
    rpc('app.bsky.actor.getProfile'),
    rpc('app.bsky.actor.getPreferences'),
  ],
  feed: [
    'repo:app.bsky.feed.post',
    'repo:app.bsky.feed.like',
    'repo:app.bsky.feed.repost',
    rpc('app.bsky.feed.getTimeline'),
    rpc('app.bsky.feed.getFeed'),
    rpc('app.bsky.feed.getPostThread'),
    rpc('app.bsky.feed.getPosts'),
    rpc('app.bsky.feed.getAuthorFeed'),
    rpc('app.bsky.feed.getFeedGenerators'),
    'blob:image/*',
  ],
  profileEdit: ['repo:app.bsky.actor.profile', 'blob:image/*'],
} as const;

export const REQUIRED_SCOPE_GROUPS = ['core', 'chat', 'socialGraph'] as const;
export const OPTIONAL_SCOPE_GROUPS = ['feed', 'profileEdit'] as const;
export type OptionalScopeGroup = (typeof OPTIONAL_SCOPE_GROUPS)[number];

export function buildOAuthScope(
  optionalGroups: OptionalScopeGroup[] = [...OPTIONAL_SCOPE_GROUPS],
): string {
  const scopes = new Set([
    ...OAUTH_SCOPE_GROUPS.core,
    ...OAUTH_SCOPE_GROUPS.chat,
    ...OAUTH_SCOPE_GROUPS.socialGraph,
    ...optionalGroups.flatMap((g) => OAUTH_SCOPE_GROUPS[g]),
  ]);
  return [...scopes].join(' ');
}

export const OAUTH_SCOPE_ALL = buildOAuthScope([...OPTIONAL_SCOPE_GROUPS]);
