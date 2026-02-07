/** ATProto Lexicon NSIDs for Chatmosphere collections */
export const NSID = {
  Room: 'app.chatmosphere.chat.room',
  Message: 'app.chatmosphere.chat.message',
  BuddyList: 'app.chatmosphere.chat.buddylist',
  Presence: 'app.chatmosphere.chat.presence',
  Poll: 'app.chatmosphere.chat.poll',
  Vote: 'app.chatmosphere.chat.vote',
  Ban: 'app.chatmosphere.chat.ban',
  Role: 'app.chatmosphere.chat.role',
} as const;

/** Namespace prefix for all Chatmosphere Lexicon records */
export const NSID_PREFIX = 'app.chatmosphere.chat.';

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
  /** Maximum room description length */
  maxRoomDescriptionLength: 500,
  /** Maximum away message length */
  maxAwayMessageLength: 300,
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
} as const;
