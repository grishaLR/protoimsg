import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { isSafeUrl } from '../lib/sanitize';
import { buildGermUrl, type GermMessageMe } from '../lib/germ';

const PUBLIC_API = 'https://public.api.bsky.app/xrpc';

interface GermResult {
  canMessage: boolean;
  germUrl: string | null;
  isLoading: boolean;
}

interface PublicProfileGerm {
  associated?: {
    germ?: GermMessageMe;
  };
}

interface PublicRelationshipsResponse {
  relationships: Array<{
    $type: string;
    did: string;
    following?: string;
    followedBy?: string;
  }>;
}

/** Fetch germ data from the public profile API — no OAuth scopes needed. */
async function fetchGermFromProfile(targetDid: string): Promise<GermMessageMe | null> {
  try {
    const res = await fetch(
      `${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(targetDid)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as PublicProfileGerm;
    return data.associated?.germ ?? null;
  } catch {
    return null;
  }
}

/** Check follow relationship via public API — no PDS proxy needed. */
async function checkFollowsViewer(targetDid: string, viewerDid: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ actor: targetDid });
    params.append('others', viewerDid);
    const res = await fetch(`${PUBLIC_API}/app.bsky.graph.getRelationships?${params}`);
    if (!res.ok) return false;
    const data = (await res.json()) as PublicRelationshipsResponse;
    const rel = data.relationships[0];
    if (!rel || rel.$type !== 'app.bsky.graph.defs#relationship') return false;
    return !!rel.following;
  } catch {
    return false;
  }
}

export function useGermDeclaration(targetDid: string | undefined): GermResult {
  const { did: viewerDid } = useAuth();

  const isSelf = !!targetDid && targetDid === viewerDid;

  const { data: germ, isLoading: germLoading } = useQuery({
    queryKey: ['germDeclaration', targetDid],
    queryFn: () => fetchGermFromProfile(targetDid as string),
    enabled: !!targetDid && !isSelf,
    staleTime: 10 * 60 * 1000,
  });

  const policy = germ?.showButtonTo;

  // Follow check via public API — no PDS proxy or OAuth scopes needed
  const { data: followsViewer, isLoading: followLoading } = useQuery({
    queryKey: ['germFollowCheck', targetDid, viewerDid],
    queryFn: () => checkFollowsViewer(targetDid as string, viewerDid as string),
    enabled: !!targetDid && !!viewerDid && policy === 'usersIFollow',
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = germLoading || (policy === 'usersIFollow' && followLoading);

  if (isSelf || !germ || !policy || policy === 'none') {
    return { canMessage: false, germUrl: null, isLoading };
  }

  const messageMeUrl = germ.messageMeUrl;
  if (!messageMeUrl || !isSafeUrl(messageMeUrl)) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  if (policy === 'usersIFollow' && !followsViewer) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  if (!targetDid || !viewerDid) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  const germUrl = buildGermUrl(messageMeUrl, targetDid, viewerDid);

  return { canMessage: true, germUrl, isLoading };
}
