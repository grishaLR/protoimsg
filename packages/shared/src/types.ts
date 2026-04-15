/** Real-time presence status */
export type PresenceStatus = 'online' | 'away' | 'idle' | 'offline' | 'invisible';

/** Who can see your presence */
export type PresenceVisibility = 'everyone' | 'community' | 'inner-circle' | 'no-one';

/** WebSocket message direction */
export type WsDirection = 'client-to-server' | 'server-to-client';
