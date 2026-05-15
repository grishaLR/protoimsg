import { useQuery } from '@tanstack/react-query';

export interface SpriteRecord {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  width: number;
  height: number;
  spriteSheet: { ref: { $link: string } };
}

export function useActorSprite(did: string | undefined, pds: string | undefined) {
  return useQuery({
    queryKey: ['actorSprite', did],
    enabled: !!did && !!pds,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpriteRecord | null> => {
      const params = new URLSearchParams({
        repo: did as string,
        collection: 'actor.rpg.sprite',
        limit: '1',
      });
      const res = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { records: Array<{ value: unknown }> };
      return (json.records[0]?.value ?? null) as SpriteRecord | null;
    },
  });
}
