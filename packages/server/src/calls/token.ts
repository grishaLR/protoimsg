import { AccessToken, type TrackSource } from 'livekit-server-sdk';

/**
 * Generates an anonymous LiveKit access token.
 *
 * The token contains ONLY a random participant ID and room name — no DID,
 * no handle, no user-identifying information. LiveKit never learns who the
 * participant actually is.
 */
export async function generateAnonymousToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  participantId: string,
  ttlSeconds = 15 * 60,
  /** Restrict what may be published — e.g. mic-only for proximity voice. */
  publish?: { sources: TrackSource[]; data: boolean },
): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantId,
    ttl: ttlSeconds,
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: publish?.data ?? true,
    ...(publish ? { canPublishSources: publish.sources } : {}),
  });

  return await token.toJwt();
}
