import { useQuery } from '@tanstack/react-query';

export interface AtmochiTile {
  /** at:// URI of the pet's published Web Tile (https://webtil.es). */
  uri: string;
  name: string;
}

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/** TID for a millisecond timestamp with clock id 0 — how atmochi.pet keys a pet's tile. */
function tidFromMillis(ms: number): string {
  let micros = ms * 1000;
  let out = '';
  for (let i = 0; i < 11; i++) {
    out = TID_ALPHABET.charAt(micros % 32) + out;
    micros = Math.floor(micros / 32);
  }
  return `${out}22`;
}

async function getRecordValue(
  pds: string,
  did: string,
  collection: string,
  rkey: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ repo: did, collection, rkey });
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as { value?: unknown };
  return json.value && typeof json.value === 'object'
    ? (json.value as Record<string, unknown>)
    : null;
}

/**
 * The Web Tile an actor published for their Atmochi pet, or null when they
 * have no pet or have not published its tile.
 *
 * atmochi.pet writes the tile to `ing.dasl.masl` under a TID derived from the
 * pet's hatch time, so other tiles in the same repo are never mistaken for it.
 */
export function useAtmochiTile(did: string | undefined, pds: string | undefined) {
  return useQuery({
    queryKey: ['atmochiTile', did],
    enabled: !!did && !!pds,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<AtmochiTile | null> => {
      const repo = did as string;
      const host = pds as string;
      const pet = await getRecordValue(host, repo, 'dev.arigonzalez.atmochi.pet', 'self', signal);
      const hatchedAt = typeof pet?.hatchedAt === 'string' ? Date.parse(pet.hatchedAt) : NaN;
      if (Number.isNaN(hatchedAt)) return null;

      const rkey = tidFromMillis(hatchedAt);
      const record = await getRecordValue(host, repo, 'ing.dasl.masl', rkey, signal);
      if (!record) return null;

      const tile =
        record.tile && typeof record.tile === 'object'
          ? (record.tile as Record<string, unknown>)
          : null;
      const name = typeof tile?.name === 'string' && tile.name ? tile.name : 'Atmochi';
      return { uri: `at://${repo}/ing.dasl.masl/${rkey}`, name };
    },
  });
}
