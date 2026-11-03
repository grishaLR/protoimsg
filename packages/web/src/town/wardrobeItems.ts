import { RPG_ITEM_COLLECTION, parseRpgItemUri } from '@protoimsg/shared';
import type { TownDisplayed, TownDisplayLook } from '@protoimsg/shared';
import { resolvePdsForDid } from '../lib/resolve-pds';
import { blobUrl } from '../lib/record-blobs';

// The rpg.actor items a wardrobe shows, read straight from the owner's PDS,
// the same way their profile's items tab reads them. Nothing goes through
// our server.

/** One item on a wardrobe, ready to draw. */
/** One of an item's pictures: its icon, or its worn layer (a sheet). */
export interface ItemPicture {
  image: string;
  /** `image` is the worn layer's 3×4 walk sheet, not an icon. */
  sheet: boolean;
  /**
   * A worn layer is drawn in grey; its colours come from this mask (blue =
   * 1st colour, green = 2nd, red = 3rd, black = leave as is)…
   */
  mask?: string;
  /** …and these, the item's channel colours (`#rrggbb`), in order. */
  colors?: string[];
}

/** One item on a wardrobe, ready to draw. */
export interface WardrobeItem extends ItemPicture {
  /** The `equipment.rpg.item` record (matches the placement's `display`). */
  uri: string;
  title: string;
  /** rpg.actor slot: where it goes on the wardrobe (hats on top, clothes hung). */
  category: string;
}

/** Same key = same pixels (image, mask and colours). */
export function pictureKey(p: ItemPicture): string {
  return [p.image, p.mask ?? '', ...(p.colors ?? [])].join('|');
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The item's channel colours, in order (each channel's `defaultColor`). */
function channelColors(v: Record<string, unknown>): string[] {
  if (!Array.isArray(v.channels)) return [];
  return v.channels
    .slice(0, 3)
    .map((c) => (c as { defaultColor?: unknown } | null)?.defaultColor)
    .filter((c): c is string => typeof c === 'string' && HEX.test(c));
}

/** Re-read an owner's items this often at most (they change rarely). */
const FRESH_MS = 5 * 60_000;
const MAX_CACHED = 500;
// Base32 CIDv1: plain characters only before it goes in a URL.
const CID = /^[a-z2-7]{20,120}$/;

const cache = new Map<string, { item: WardrobeItem | null; at: number }>();

/**
 * A blob's CID, whichever way the record was read: raw JSON has
 * `ref: { $link }`; records from the `@atproto/api` client have a CID object
 * there instead (its string form is the CID).
 */
function blobCid(b: unknown): string | null {
  const ref = (b as { ref?: unknown } | null)?.ref;
  if (!ref || typeof ref !== 'object') return null;
  const link = (ref as { $link?: unknown }).$link;
  // A plain object's toString would just say "[object Object]"; the regex rejects that.
  const cid = typeof link === 'string' ? link : (ref as { toString(): string }).toString();
  return CID.test(cid) ? cid : null;
}

async function readItem(pds: string, owner: string, rkey: string, signal: AbortSignal) {
  const params = new URLSearchParams({ repo: owner, collection: RPG_ITEM_COLLECTION, rkey });
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`, { signal });
  // Deleted (or never there): nothing to show.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`getRecord ${String(res.status)}`);
  const body = (await res.json()) as { value?: unknown };
  return body.value && typeof body.value === 'object'
    ? (body.value as Record<string, unknown>)
    : null;
}

/** Where an item's two pictures live (either may be missing). */
export async function picturesOf(
  v: Record<string, unknown>,
  owner: string,
  pds: string,
): Promise<{ icon: ItemPicture | null; worn: ItemPicture | null }> {
  const iconCid = blobCid(v.icon);
  // The icon is a blob in the owner's repo.
  const icon = iconCid ? { image: blobUrl(pds, owner, iconCid), sheet: false } : null;
  // The worn layer: the item's own copy (owner's repo), coloured by its mask.
  const assetCid = blobCid(v.asset);
  if (assetCid) {
    const maskCid = blobCid(v.colorway);
    const colors = channelColors(v);
    return {
      icon,
      worn: {
        image: blobUrl(pds, owner, assetCid),
        sheet: true,
        ...(maskCid && colors.length ? { mask: blobUrl(pds, owner, maskCid), colors } : {}),
      },
    };
  }
  // Older items only name the sheet (`assetCid`), a blob in the provider's
  // repo, as the gift popup loads it.
  const asset = typeof v.assetCid === 'string' && CID.test(v.assetCid) ? v.assetCid : null;
  const provider =
    typeof v.provider === 'string' && v.provider.startsWith('did:') ? v.provider : null;
  const providerPds = asset && provider ? await resolvePdsForDid(provider) : null;
  return {
    icon,
    worn:
      asset && provider && providerPds
        ? { image: blobUrl(providerPds, provider, asset), sheet: true }
        : null,
  };
}

/**
 * The picture for `look`: the icon by default, or `worn`, the sheet's
 * front-facing standing frame (in colour). Whichever is missing falls back
 * to the other; neither, nothing to draw.
 */
export async function artOf(
  v: Record<string, unknown>,
  owner: string,
  pds: string,
  look: TownDisplayLook = 'icon',
): Promise<ItemPicture | null> {
  const { icon, worn } = await picturesOf(v, owner, pds);
  return look === 'worn' ? (worn ?? icon) : (icon ?? worn);
}

/**
 * The items `owner` chose for their wardrobes, in order, each in its chosen
 * look. Only items in the owner's own repo; ones that are gone or have no
 * art are left out. A read that fails is retried next time rather than
 * remembered.
 */
export async function loadWardrobeItems(
  owner: string,
  display: readonly TownDisplayed[],
  signal: AbortSignal,
): Promise<WardrobeItem[]> {
  const now = Date.now();
  const keyOf = (d: TownDisplayed) => `${d.item}|${d.look ?? 'icon'}`;
  const todo = display.filter((d) => {
    const hit = cache.get(keyOf(d));
    return !hit || now - hit.at > FRESH_MS;
  });
  if (todo.length > 0) {
    const pds = await resolvePdsForDid(owner);
    if (pds) {
      await Promise.all(
        todo.map(async (d) => {
          const uri = d.item;
          const ref = parseRpgItemUri(uri);
          if (ref?.did !== owner) return;
          try {
            const v = await readItem(pds, owner, ref.rkey, signal);
            const title = typeof v?.title === 'string' ? v.title.trim().slice(0, 64) : '';
            const art = v && title ? await artOf(v, owner, pds, d.look) : null;
            const category = typeof v?.category === 'string' ? v.category : '';
            remember(keyOf(d), art ? { uri, title, category, ...art } : null);
          } catch {
            // Unreachable for now: leave it out, try again next time.
          }
        }),
      );
    }
  }
  return display.map((d) => cache.get(keyOf(d))?.item).filter((i): i is WardrobeItem => !!i);
}

function remember(key: string, item: WardrobeItem | null): void {
  cache.delete(key);
  cache.set(key, { item, at: Date.now() });
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
