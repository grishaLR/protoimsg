import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { resolvePdsForDid } from '../lib/resolve-pds';

interface DescribeRepoResponse {
  did: string;
  handle: string;
  collections: string[];
}

interface ListRecordsResponse {
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
}

/** List every collection NSID a DID writes to on its PDS. */
export function useActorCollections(did: string | undefined) {
  return useQuery({
    queryKey: ['actorCollections', did],
    enabled: !!did,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const pds = await resolvePdsForDid(did as string);
      if (!pds) throw new Error(`Could not resolve PDS for ${did}`);
      const res = await fetch(
        `${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did as string)}`,
      );
      if (!res.ok) throw new Error(`describeRepo failed: ${res.status}`);
      const data = (await res.json()) as DescribeRepoResponse;
      return { pds, did: data.did, handle: data.handle, collections: data.collections };
    },
  });
}

/** Paginated records from one collection on a DID's PDS. */
export function useActorRecords(did: string | undefined, collection: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['actorRecords', did, collection],
    enabled: !!did && !!collection,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListRecordsResponse) => lastPage.cursor,
    queryFn: async ({ pageParam }): Promise<ListRecordsResponse> => {
      const pds = await resolvePdsForDid(did as string);
      if (!pds) throw new Error(`Could not resolve PDS for ${did}`);
      const params = new URLSearchParams({
        repo: did as string,
        collection: collection as string,
        limit: '30',
      });
      if (pageParam) params.set('cursor', pageParam);
      const res = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
      if (!res.ok) throw new Error(`listRecords failed: ${res.status}`);
      return (await res.json()) as ListRecordsResponse;
    },
  });
}
