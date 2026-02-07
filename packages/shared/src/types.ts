/** Room visibility determines discoverability */
export type RoomVisibility = 'public' | 'unlisted' | 'private';

/** Room purpose categorization */
export type RoomPurpose = 'discussion' | 'event' | 'community' | 'support';

/** Real-time presence status */
export type PresenceStatus = 'online' | 'away' | 'idle' | 'offline' | 'invisible';

/** Who can see your presence */
export type PresenceVisibility = 'everyone' | 'close-friends' | 'nobody';

/** Moderator role assignment */
export type ModeratorRole = 'moderator' | 'owner';

/** Moderation action types */
export type ModAction = 'ban' | 'report' | 'mute';

/** WebSocket message direction */
export type WsDirection = 'client-to-server' | 'server-to-client';
