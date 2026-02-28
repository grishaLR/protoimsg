import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { isSafeUrl } from '../lib/sanitize';
import { GERM_DECLARATION_NSID, buildGermUrl, type GermDeclaration } from '../lib/germ';

const PUBLIC_API = 'https://public.api.bsky.app';

interface GermResult {
  canMessage: boolean;
  germUrl: string | null;
  isLoading: boolean;
}

/** Unauthenticated getRecord via the public ATProto API — no OAuth scopes needed. */
async function fetchGermDeclaration(targetDid: string): Promise<GermDeclaration | null> {
  const params = new URLSearchParams({
    repo: targetDid,
    collection: GERM_DECLARATION_NSID,
    rkey: 'self',
  });
  const res = await fetch(`${PUBLIC_API}/xrpc/com.atproto.repo.getRecord?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { value: GermDeclaration };
  return data.value;
}

export function useGermDeclaration(targetDid: string | undefined): GermResult {
  const { agent, did: viewerDid, hasBskyReads } = useAuth();

  const isSelf = !!targetDid && targetDid === viewerDid;

  const { data: declaration, isLoading: declarationLoading } = useQuery({
    queryKey: ['germDeclaration', targetDid],
    queryFn: () => fetchGermDeclaration(targetDid as string),
    enabled: !!targetDid && !isSelf,
    staleTime: 10 * 60 * 1000,
  });

  const policy = declaration?.messageMe.showButtonTo;

  // Follow check still needs bsky scopes — degrade gracefully without them
  const { data: followsViewer, isLoading: followLoading } = useQuery({
    queryKey: ['germFollowCheck', targetDid, viewerDid],
    queryFn: async () => {
      if (!agent || !targetDid || !viewerDid) return false;
      try {
        const res = await agent.app.bsky.graph.getRelationships({
          actor: targetDid,
          others: [viewerDid],
        });
        const rel = res.data.relationships[0];
        if (!rel || rel.$type !== 'app.bsky.graph.defs#relationship') return false;
        return !!rel.following;
      } catch {
        return false;
      }
    },
    enabled: !!agent && !!targetDid && !!viewerDid && hasBskyReads && policy === 'usersIFollow',
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = declarationLoading || (policy === 'usersIFollow' && followLoading);

  if (isSelf || !declaration || !policy || policy === 'none') {
    return { canMessage: false, germUrl: null, isLoading };
  }

  const messageMeUrl = declaration.messageMe.messageMeUrl;
  if (!messageMeUrl || !isSafeUrl(messageMeUrl)) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  // Without bsky scopes we can't verify follow status — hide the button
  if (policy === 'usersIFollow' && !followsViewer) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  if (!targetDid || !viewerDid) {
    return { canMessage: false, germUrl: null, isLoading };
  }

  const germUrl = buildGermUrl(messageMeUrl, targetDid, viewerDid);

  return { canMessage: true, germUrl, isLoading };
}
