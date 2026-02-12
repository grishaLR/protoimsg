import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useWebSocket } from '../contexts/WebSocketContext';
import { getCachedVisibility } from './usePresence';
import { getCommunityListRecord, putCommunityListRecord, generateTid } from '../lib/atproto';
import { fetchPresence } from '../lib/api';
import { playDoorOpen, playDoorClose } from '../lib/sounds';
import type { CommunityGroup } from '@protoimsg/lexicon';
import type { MemberWithPresence } from '../types';
import type { ServerMessage } from '@protoimsg/shared';

export type DoorEvent = 'join' | 'leave';

const DEFAULT_GROUP = 'Community';
const INNER_CIRCLE_GROUP = 'Inner Circle';
const PROTECTED_GROUPS = new Set([DEFAULT_GROUP, INNER_CIRCLE_GROUP]);
const MAX_GROUPS = 50;
const DOOR_LINGER_MS = 5000;

export function useBuddyList() {
  const { agent } = useAuth();
  const { send, subscribe } = useWebSocket();
  const [buddies, setBuddies] = useState<MemberWithPresence[]>([]);
  const [doorEvents, setDoorEvents] = useState<Record<string, DoorEvent>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const doorTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // M46: ref for callbacks to read latest groups — avoids stale closure when rapid ops occur
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // Derive inner-circle DIDs from groups (memoized to avoid recomputing on every render)
  const innerCircleDids = useMemo(
    () =>
      new Set(
        groups.filter((g) => g.isInnerCircle === true).flatMap((g) => g.members.map((m) => m.did)),
      ),
    [groups],
  );

  // Load buddy list from PDS + fetch presence
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!agent) return;

    cancelledRef.current = false;
    const currentAgent = agent;

    setError(null);
    async function load() {
      try {
        const pdsGroups = await getCommunityListRecord(currentAgent);
        if (cancelledRef.current) return;

        // Migrate legacy "Buddies" → "Community", "Close Friends" → "Inner Circle"
        let seeded = pdsGroups.map((g) => {
          if (g.name === 'Buddies') return { ...g, name: DEFAULT_GROUP };
          if (g.name === 'Close Friends')
            return { ...g, name: INNER_CIRCLE_GROUP, isInnerCircle: true };
          return g;
        });

        // Deduplicate: merge members of groups with the same name
        const groupMap = new Map<string, CommunityGroup>();
        for (const g of seeded) {
          const existing = groupMap.get(g.name);
          if (existing) {
            const existingDids = new Set(existing.members.map((m) => m.did));
            const merged = [
              ...existing.members,
              ...g.members.filter((m) => !existingDids.has(m.did)),
            ];
            groupMap.set(g.name, { ...existing, members: merged });
          } else {
            groupMap.set(g.name, g);
          }
        }
        seeded = [...groupMap.values()];

        // Ensure the two default groups always exist (even if empty)
        const hasDefault = seeded.some((g) => g.name === DEFAULT_GROUP);
        const hasInnerCircle = seeded.some((g) => g.name === INNER_CIRCLE_GROUP);
        if (!hasDefault) seeded = [{ name: DEFAULT_GROUP, members: [] }, ...seeded];
        if (!hasInnerCircle)
          seeded = [...seeded, { name: INNER_CIRCLE_GROUP, isInnerCircle: true, members: [] }];

        // Persist if anything changed
        if (JSON.stringify(seeded) !== JSON.stringify(pdsGroups)) {
          await putCommunityListRecord(currentAgent, seeded);
        }
        setGroups(seeded);

        // Flatten all DIDs (deduplicated)
        const addedAtMap = new Map<string, string>();
        for (const g of pdsGroups) {
          for (const m of g.members) {
            if (!addedAtMap.has(m.did)) {
              addedAtMap.set(m.did, m.addedAt);
            }
          }
        }
        const allDids = [...addedAtMap.keys()];

        if (allDids.length === 0) {
          setBuddies([]);
          setLoading(false);
          return;
        }

        const cfDids = new Set(
          pdsGroups
            .filter((g) => g.isInnerCircle === true)
            .flatMap((g) => g.members.map((m) => m.did)),
        );

        // Fetch atproto block records to restore blockRkey for unblock operations
        const blockMap = new Map<string, string>(); // subject DID → rkey
        try {
          let blockCursor: string | undefined;
          do {
            const res = await currentAgent.com.atproto.repo.listRecords({
              repo: currentAgent.assertDid,
              collection: 'app.bsky.graph.block',
              limit: 100,
              cursor: blockCursor,
            });
            for (const rec of res.data.records) {
              const subject = (rec.value as { subject?: string }).subject;
              if (subject) {
                const rkey = rec.uri.split('/').pop();
                if (rkey) blockMap.set(subject, rkey);
              }
            }
            blockCursor = res.data.cursor;
          } while (blockCursor);
        } catch {
          // Non-critical — block state just won't be restored
        }

        // Default all buddies to offline — WS request_community_presence
        // will deliver block-filtered presence shortly after
        setBuddies(
          allDids.map((did) => ({
            did,
            status: 'offline',
            addedAt: addedAtMap.get(did) ?? new Date().toISOString(),
            isInnerCircle: cfDids.has(did),
            blockRkey: blockMap.get(did),
          })),
        );
        setLoading(false);

        // Sync community data to server so visibility checks work
        send({ type: 'sync_community', groups: seeded });
        // Re-broadcast visibility now that community data is synced.
        // The server queues messages, so sync_community's DB writes complete
        // before this status_change triggers communityWatchers.notify.
        const cachedVis = getCachedVisibility();
        send({ type: 'status_change', status: 'online', visibleTo: cachedVis });
        // Request block-filtered presence via WS
        send({ type: 'request_community_presence', dids: allDids });
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [agent, send]);

  const triggerDoor = useCallback((did: string, event: DoorEvent) => {
    if (event === 'join') playDoorOpen();
    else playDoorClose();

    setDoorEvents((prev) => ({ ...prev, [did]: event }));
    const t = setTimeout(() => {
      doorTimersRef.current.delete(t);
      setDoorEvents((prev) => {
        const { [did]: _, ...rest } = prev;
        return rest;
      });
    }, DOOR_LINGER_MS);
    doorTimersRef.current.add(t);
  }, []);

  const checkTransition = useCallback(
    (did: string, newStatus: string) => {
      const prev = prevStatusRef.current.get(did);
      prevStatusRef.current.set(did, newStatus);
      if (!prev) return; // initial load, no sound
      const wasOnline = prev !== 'offline';
      const isOnline = newStatus !== 'offline';
      if (!wasOnline && isOnline) triggerDoor(did, 'join');
      else if (wasOnline && !isOnline) triggerDoor(did, 'leave');
    },
    [triggerDoor],
  );

  // Subscribe to presence + community_presence WS events
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'community_presence') {
        for (const p of msg.data) {
          checkTransition(p.did, p.status);
        }
        setBuddies((prev) => {
          const presMap = new Map(msg.data.map((p) => [p.did, p]));
          return prev.map((b) => {
            const update = presMap.get(b.did);
            if (update) {
              return { ...b, status: update.status, awayMessage: update.awayMessage };
            }
            return b;
          });
        });
      } else if (msg.type === 'presence') {
        checkTransition(msg.data.did, msg.data.status);
        setBuddies((prev) =>
          prev.map((b) =>
            b.did === msg.data.did
              ? { ...b, status: msg.data.status, awayMessage: msg.data.awayMessage }
              : b,
          ),
        );
      }
    });

    return unsub;
  }, [subscribe, checkTransition]);

  const addBuddy = useCallback(
    async (did: string) => {
      if (!agent) return;

      const currentGroups = groupsRef.current;
      const now = new Date().toISOString();
      const newMember = { did, addedAt: now };

      // Update local groups
      let updatedGroups: CommunityGroup[];
      const defaultGroup = currentGroups.find((g) => g.name === DEFAULT_GROUP);
      if (defaultGroup) {
        if (defaultGroup.members.some((m) => m.did === did)) return; // already exists
        updatedGroups = currentGroups.map((g) =>
          g.name === DEFAULT_GROUP ? { ...g, members: [...g.members, newMember] } : g,
        );
      } else {
        updatedGroups = [...currentGroups, { name: DEFAULT_GROUP, members: [newMember] }];
      }

      setGroups(updatedGroups);
      setBuddies((prev) => [...prev, { did, status: 'offline', addedAt: now }]);

      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });

      // Fetch their current presence
      const presenceList = await fetchPresence([did]);
      const buddyPresence = presenceList[0];
      if (buddyPresence) {
        setBuddies((prev) =>
          prev.map((b) =>
            b.did === did
              ? { ...b, status: buddyPresence.status, awayMessage: buddyPresence.awayMessage }
              : b,
          ),
        );
      }
    },
    [agent, send],
  );

  const removeBuddy = useCallback(
    async (did: string) => {
      if (!agent) return;

      const updatedGroups = groupsRef.current.map((g) => ({
        ...g,
        members: g.members.filter((m) => m.did !== did),
      }));

      setGroups(updatedGroups);
      setBuddies((prev) => prev.filter((b) => b.did !== did));

      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  const toggleInnerCircle = useCallback(
    async (did: string) => {
      if (!agent) return;

      const currentGroups = groupsRef.current;
      let cfGroup = currentGroups.find((g) => g.name === INNER_CIRCLE_GROUP);
      let updatedGroups: CommunityGroup[];

      if (!cfGroup) {
        // Create close friends group with this member
        cfGroup = {
          name: INNER_CIRCLE_GROUP,
          isInnerCircle: true,
          members: [{ did, addedAt: new Date().toISOString() }],
        };
        updatedGroups = [...currentGroups, cfGroup];
      } else {
        const alreadyIn = cfGroup.members.some((m) => m.did === did);
        if (alreadyIn) {
          // Remove from close friends
          updatedGroups = currentGroups.map((g) =>
            g.name === INNER_CIRCLE_GROUP
              ? { ...g, members: g.members.filter((m) => m.did !== did) }
              : g,
          );
        } else {
          // Add to close friends
          updatedGroups = currentGroups.map((g) =>
            g.name === INNER_CIRCLE_GROUP
              ? { ...g, members: [...g.members, { did, addedAt: new Date().toISOString() }] }
              : g,
          );
        }
      }

      setGroups(updatedGroups);
      // Update buddy's isInnerCircle flag
      const newCfDids = new Set(
        updatedGroups
          .filter((g) => g.isInnerCircle === true)
          .flatMap((g) => g.members.map((m) => m.did)),
      );
      setBuddies((prev) => prev.map((b) => ({ ...b, isInnerCircle: newCfDids.has(b.did) })));

      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  const blockBuddy = useCallback(
    async (did: string, isCurrentlyBlocked: boolean) => {
      if (!agent) return;

      const buddy = buddies.find((b) => b.did === did);
      if (!buddy) return;

      if (isCurrentlyBlocked && buddy.blockRkey) {
        // Delete the atproto block record
        await agent.com.atproto.repo.deleteRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.graph.block',
          rkey: buddy.blockRkey,
        });
        setBuddies((prev) => prev.map((b) => (b.did === did ? { ...b, blockRkey: undefined } : b)));
      } else {
        // Create an atproto block record
        const rkey = generateTid();
        await agent.com.atproto.repo.createRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.graph.block',
          rkey,
          record: {
            $type: 'app.bsky.graph.block',
            subject: did,
            createdAt: new Date().toISOString(),
          },
        });
        setBuddies((prev) => prev.map((b) => (b.did === did ? { ...b, blockRkey: rkey } : b)));
      }
    },
    [agent, buddies],
  );

  const createGroup = useCallback(
    async (name: string) => {
      if (!agent) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const currentGroups = groupsRef.current;
      if (currentGroups.some((g) => g.name === trimmed)) return;
      if (currentGroups.length >= MAX_GROUPS) return;

      const updatedGroups = [...currentGroups, { name: trimmed, members: [] }];
      setGroups(updatedGroups);
      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  const renameGroup = useCallback(
    async (oldName: string, newName: string) => {
      if (!agent) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      const currentGroups = groupsRef.current;
      if (currentGroups.some((g) => g.name === trimmed)) return;

      const updatedGroups = currentGroups.map((g) =>
        g.name === oldName ? { ...g, name: trimmed } : g,
      );
      setGroups(updatedGroups);
      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  const deleteGroup = useCallback(
    async (name: string) => {
      if (!agent) return;
      if (PROTECTED_GROUPS.has(name)) return;
      const currentGroups = groupsRef.current;
      const group = currentGroups.find((g) => g.name === name);
      if (!group || group.members.length > 0) return;

      const updatedGroups = currentGroups.filter((g) => g.name !== name);
      setGroups(updatedGroups);
      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  const moveBuddy = useCallback(
    async (did: string, fromGroup: string, toGroup: string) => {
      if (!agent || fromGroup === toGroup) return;

      const updatedGroups = groupsRef.current.map((g) => {
        if (g.name === fromGroup) {
          return { ...g, members: g.members.filter((m) => m.did !== did) };
        }
        if (g.name === toGroup) {
          if (g.members.some((m) => m.did === did)) return g;
          return { ...g, members: [...g.members, { did, addedAt: new Date().toISOString() }] };
        }
        return g;
      });

      setGroups(updatedGroups);
      await putCommunityListRecord(agent, updatedGroups);
      send({ type: 'sync_community', groups: updatedGroups });
    },
    [agent, send],
  );

  // Cleanup door timers on unmount
  useEffect(() => {
    return () => {
      for (const t of doorTimersRef.current) clearTimeout(t);
      doorTimersRef.current.clear();
    };
  }, []);

  return {
    buddies,
    groups,
    doorEvents,
    loading,
    error,
    addBuddy,
    removeBuddy,
    toggleInnerCircle,
    blockBuddy,
    innerCircleDids,
    agent,
    createGroup,
    renameGroup,
    deleteGroup,
    moveBuddy,
  };
}
