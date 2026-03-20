import { publicAgent } from './public-agent';

const TYPEAHEAD_URL = 'https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead';

export interface ActorSearchResult {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface TypeaheadResponse {
  actors: ActorSearchResult[];
}

/**
 * Try to resolve a handle directly via ATProto identity resolution.
 * Returns a single-element array on success, empty on failure.
 */
async function resolveHandleDirect(handle: string): Promise<ActorSearchResult[]> {
  try {
    const res = await publicAgent.resolveHandle({ handle });
    const did = res.data.did;
    // Fetch profile for display name / avatar
    try {
      const profile = await publicAgent.getProfile({ actor: did });
      return [
        {
          did,
          handle: profile.data.handle,
          displayName: profile.data.displayName,
          avatar: profile.data.avatar,
        },
      ];
    } catch {
      return [{ did, handle }];
    }
  } catch {
    return [];
  }
}

export async function searchActorsTypeahead(query: string): Promise<ActorSearchResult[]> {
  const url = `${TYPEAHEAD_URL}?q=${encodeURIComponent(query)}&limit=8`;
  const res = await fetch(url, { headers: { 'X-Client': 'protoimsg.app' } });
  if (!res.ok) return [];
  const data = (await res.json()) as TypeaheadResponse;
  const actors = data.actors;

  // If query looks like a handle and typeahead didn't find an exact match, resolve directly
  if (query.includes('.') && !actors.some((a) => a.handle === query)) {
    const resolved = await resolveHandleDirect(query);
    const match = resolved[0];
    if (match && !actors.some((a) => a.did === match.did)) {
      actors.unshift(match);
    }
  }

  return actors;
}
