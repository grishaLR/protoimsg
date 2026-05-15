import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { PDS_URL, GAME_MASTER_DID } from '../lib/config';

const GIVE_COLLECTION = 'equipment.rpg.give';
const ITEM_COLLECTION = 'equipment.rpg.item';

export interface AcceptedGift {
  uri: string;
  item: string;
  title: string;
  assetCid: string;
  description?: string;
  context?: string;
  givenAt: string;
  providerHandle?: string;
}

interface GiveRecord {
  uri: string;
  value: {
    item: string;
    kind: string;
    title: string;
    assetCid: string;
    category: string;
    recipient: string;
    givenAt: string;
    context?: string;
    description?: string;
  };
}

interface ListRecordsResponse {
  records: Array<{ uri: string; value: Record<string, unknown> }>;
  cursor?: string;
}

async function resolveHandle(did: string): Promise<string> {
  try {
    const res = await fetch(
      `${PDS_URL}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`,
    );
    if (!res.ok) return did;
    const data = (await res.json()) as { handle: string };
    return data.handle;
  } catch {
    return did;
  }
}

async function fetchPendingGives(userDid: string): Promise<GiveRecord[]> {
  const pending: GiveRecord[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: GAME_MASTER_DID,
      collection: GIVE_COLLECTION,
      limit: '100',
      ...(cursor ? { cursor } : {}),
    });
    const res = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.listRecords?${params}`);
    if (!res.ok) break;
    const data = (await res.json()) as ListRecordsResponse;

    for (const r of data.records) {
      const v = r.value as GiveRecord['value'];
      if (v.recipient === userDid) {
        pending.push({ uri: r.uri, value: v });
      }
    }
    cursor = data.cursor;
  } while (cursor);

  return pending;
}

async function hasItemRecord(agent: Agent, userDid: string, giveUri: string): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: userDid,
      collection: ITEM_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const v = r.value as Record<string, unknown>;
      if (v.give === giveUri) return true;
    }
    cursor = res.data.cursor;
  } while (cursor);
  return false;
}

async function acceptGive(agent: Agent, userDid: string, give: GiveRecord): Promise<void> {
  await agent.com.atproto.repo.createRecord({
    repo: userDid,
    collection: ITEM_COLLECTION,
    record: {
      $type: ITEM_COLLECTION,
      give: give.uri,
      item: give.value.item,
      kind: give.value.kind,
      title: give.value.title,
      assetCid: give.value.assetCid,
      category: give.value.category,
      provider: GAME_MASTER_DID,
      acceptedAt: new Date().toISOString(),
      ...(give.value.context ? { context: give.value.context } : {}),
      ...(give.value.description ? { description: give.value.description } : {}),
    },
  });
}

export function useGiftAcceptance(agent: Agent | null, did: string | null) {
  const [queue, setQueue] = useState<AcceptedGift[]>([]);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!agent || !did) return;
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        const pending = await fetchPendingGives(did);
        if (pending.length === 0) return;

        const providerHandle = await resolveHandle(GAME_MASTER_DID);

        const newlyAccepted: AcceptedGift[] = [];
        for (const give of pending) {
          const already = await hasItemRecord(agent, did, give.uri);
          if (already) continue;
          await acceptGive(agent, did, give);
          newlyAccepted.push({
            uri: give.uri,
            item: give.value.item,
            title: give.value.title,
            assetCid: give.value.assetCid,
            description: give.value.description,
            context: give.value.context,
            givenAt: give.value.givenAt,
            providerHandle,
          });
        }
        if (newlyAccepted.length > 0) setQueue(newlyAccepted);
      } catch {
        // Non-critical — gift acceptance is best-effort
      }
    })();
  }, [agent, did]);

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  return { current: queue[0] ?? null, dismiss };
}
