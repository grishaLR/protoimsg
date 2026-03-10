import { useState, useEffect } from 'react';
import { useAuth } from '@/services/auth';
import { buildGermUrl, type GermMessageMe } from '@/lib/germ';

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

async function checkFollowsViewer(targetDid: string, viewerDid: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ actor: targetDid });
    params.append('others', viewerDid);
    const res = await fetch(`${PUBLIC_API}/app.bsky.graph.getRelationships?${params}`);
    if (!res.ok) return false;
    const data = (await res.json()) as PublicRelationshipsResponse;
    const rel = data.relationships[0];
    if (!rel || rel.$type !== 'app.bsky.graph.defs#relationship') return false; // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- runtime safety
    return !!rel.following;
  } catch {
    return false;
  }
}

// Simple cache to avoid re-fetching on re-renders
const germCache = new Map<string, { germ: GermMessageMe | null; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export function useGermDeclaration(targetDid: string | undefined): GermResult {
  const { did: viewerDid } = useAuth();
  const [germ, setGerm] = useState<GermMessageMe | null>(null);
  const [followsViewer, setFollowsViewer] = useState(false);
  const [loading, setLoading] = useState(false);

  const isSelf = !!targetDid && targetDid === viewerDid;

  useEffect(() => {
    if (!targetDid || isSelf) return;

    const cached = germCache.get(targetDid);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setGerm(cached.germ);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchGermFromProfile(targetDid).then((result) => {
      if (cancelled) return;
      germCache.set(targetDid, { germ: result, ts: Date.now() });
      setGerm(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [targetDid, isSelf]);

  useEffect(() => {
    if (!targetDid || !viewerDid || germ?.showButtonTo !== 'usersIFollow') return;

    let cancelled = false;
    void checkFollowsViewer(targetDid, viewerDid).then((result) => {
      if (cancelled) return;
      setFollowsViewer(result);
    });

    return () => {
      cancelled = true;
    };
  }, [targetDid, viewerDid, germ?.showButtonTo]);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
  if (isSelf || !germ || !germ.showButtonTo || germ.showButtonTo === 'none') {
    return { canMessage: false, germUrl: null, isLoading: loading };
  }

  const messageMeUrl = germ.messageMeUrl;
  if (!messageMeUrl) {
    return { canMessage: false, germUrl: null, isLoading: loading };
  }

  if (germ.showButtonTo === 'usersIFollow' && !followsViewer) {
    return { canMessage: false, germUrl: null, isLoading: loading };
  }

  if (!targetDid || !viewerDid) {
    return { canMessage: false, germUrl: null, isLoading: loading };
  }

  const germUrl = buildGermUrl(messageMeUrl, targetDid, viewerDid);
  return { canMessage: true, germUrl, isLoading: loading };
}
