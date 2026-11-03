import { RPG_ACTOR_API_URL } from './config';
import { resolvePdsForDid } from './resolve-pds';

/**
 * rpg.actor's normalized sprite endpoint. This is the same source the town
 * (`WorldEngine`) loads avatars from — a purpose-built image endpoint with a
 * correct `image/*` content-type and real CORS headers.
 *
 * The arcade games used to load the sprite from the raw `com.atproto.sync.getBlob`
 * blob on the user's PDS, which fails cross-origin both ways: with `crossOrigin`
 * it hard-fails on PDSes that omit CORS headers; without it the opaque response
 * is killed by Firefox's OpaqueResponseBlocking. Routing through rpg.actor
 * sidesteps both — the image itself needs only the DID. So: a sprite that
 * renders in the town renders in a game. `version` only busts the browser
 * cache (see `currentSpriteUrl`).
 */
export function normalizedSpriteUrl(did: string, version?: string | null): string {
  const url = `${RPG_ACTOR_API_URL}/api/sprite/normalized?did=${encodeURIComponent(did)}`;
  return version ? `${url}&v=${encodeURIComponent(version)}` : url;
}

/** Give up on the version lookup after this long: a slow PDS mustn't hold up the sprite. */
const VERSION_TIMEOUT_MS = 1_500;

/** A DID's PDS rarely moves: resolve it once per page load. */
const pdsCache = new Map<string, Promise<string | null>>();

/**
 * The current sprite's blob CID, read fresh from the owner's PDS (null if
 * unknown). rpg.actor serves the normalized sheet with a 6-hour
 * `cache-control`, and its URL is the same before and after a change, so
 * without a version a new sprite stays hidden behind the browser's cached copy.
 */
async function spriteVersion(did: string): Promise<string | null> {
  let pds = pdsCache.get(did);
  if (!pds) {
    pds = resolvePdsForDid(did);
    pdsCache.set(did, pds);
  }
  const endpoint = await pds;
  if (!endpoint) {
    pdsCache.delete(did); // a blip: try again next time
    return null;
  }
  const params = new URLSearchParams({ repo: did, collection: 'actor.rpg.sprite', rkey: 'self' });
  const res = await fetch(`${endpoint}/xrpc/com.atproto.repo.getRecord?${params}`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    cid?: string;
    value?: { spriteSheet?: { ref?: { $link?: string } } };
  };
  return json.value?.spriteSheet?.ref?.$link ?? json.cid ?? null;
}

/**
 * The normalized sprite URL, versioned by the current sprite so a change shows
 * at once. Falls back to the plain URL if the version can't be read in time.
 */
export async function currentSpriteUrl(did: string): Promise<string> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, VERSION_TIMEOUT_MS);
  });
  const version = await Promise.race([spriteVersion(did).catch(() => null), timeout]);
  return normalizedSpriteUrl(did, version);
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
