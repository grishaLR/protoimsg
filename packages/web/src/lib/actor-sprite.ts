import { RPG_ACTOR_API_URL } from './config';

/**
 * rpg.actor's normalized sprite endpoint. This is the same source the town
 * (`WorldEngine`) loads avatars from — a purpose-built image endpoint with a
 * correct `image/*` content-type and real CORS headers.
 *
 * The arcade games used to load the sprite from the raw `com.atproto.sync.getBlob`
 * blob on the user's PDS, which fails cross-origin both ways: with `crossOrigin`
 * it hard-fails on PDSes that omit CORS headers; without it the opaque response
 * is killed by Firefox's OpaqueResponseBlocking. Routing through rpg.actor
 * sidesteps both — and needs only the DID (no PDS resolution, no
 * `actor.rpg.sprite` record). So: a sprite that renders in the town renders in
 * a game.
 */
export function normalizedSpriteUrl(did: string): string {
  return `${RPG_ACTOR_API_URL}/api/sprite/normalized?did=${encodeURIComponent(did)}`;
}

/**
 * Fixed layout of every rpg.actor `/normalized` sheet: a 3×4 grid of 48px cells
 * (3 walk-cycle columns × 4 direction rows — see `town/Avatar.ts`). The arcade
 * engines take a sprite record for their frame math; this is the constant one
 * that describes a normalized sheet.
 */
export const NORMALIZED_SPRITE = {
  frameWidth: 48,
  frameHeight: 48,
  columns: 3,
  width: 144,
  height: 192,
  spriteSheet: { ref: { $link: '' } },
};
