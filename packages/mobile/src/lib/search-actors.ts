const TYPEAHEAD_URL = 'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead';

export interface ActorSearchResult {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface TypeaheadResponse {
  actors: ActorSearchResult[];
}

export async function searchActorsTypeahead(query: string): Promise<ActorSearchResult[]> {
  const url = `${TYPEAHEAD_URL}?q=${encodeURIComponent(query)}&limit=8`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as TypeaheadResponse;
  return data.actors;
}
