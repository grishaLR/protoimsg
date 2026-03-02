import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/services/auth';
import { useWebSocket } from '@/services/WebSocketContext';
import { getCachedVisibility } from './usePresence';
import { getCommunityListRecord, putCommunityListRecord } from '@/services/atproto';
import type { CommunityGroup } from '@protoimsg/lexicon';
import type { MemberWithPresence, DoorEvent } from '@/types';
import type { ServerMessage } from '@protoimsg/shared';

const DEFAULT_GROUP = 'Community';
const INNER_CIRCLE_GROUP = 'Inner Circle';
const DOOR_LINGER_MS = 5000;

export function useBuddyList() {
  const { agent } = useAuth();
  const { send, subscribe, connected } = useWebSocket();
  const [buddies, setBuddies] = useState<MemberWithPresence[]>([]);
  const [doorEvents, setDoorEvents] = useState<Record<string, DoorEvent>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const doorTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const innerCircleDids = useMemo(
    () =>
      new Set(
        groups.filter((g) => g.isInnerCircle === true).flatMap((g) => g.members.map((m) => m.did)),
      ),
    [groups],
  );

  useEffect(() => {
    if (!agent || !connected) return;

    let cancelled = false;
    const currentAgent = agent;

    setError(null);
    async function load() {
      try {
        const pdsGroups = await getCommunityListRecord(currentAgent);
        if (cancelled) return;

        // Migrate legacy group names
        let seeded = pdsGroups.map((g) => {
          if (g.name === 'Buddies') return { ...g, name: DEFAULT_GROUP };
          if (g.name === 'Close Friends')
            return { ...g, name: INNER_CIRCLE_GROUP, isInnerCircle: true };
          return g;
        });

        // Deduplicate groups
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

        // Ensure default groups exist
        if (!seeded.some((g) => g.name === DEFAULT_GROUP))
          seeded = [{ name: DEFAULT_GROUP, members: [] }, ...seeded];
        if (!seeded.some((g) => g.name === INNER_CIRCLE_GROUP))
          seeded = [...seeded, { name: INNER_CIRCLE_GROUP, isInnerCircle: true, members: [] }];

        if (JSON.stringify(seeded) !== JSON.stringify(pdsGroups)) {
          await putCommunityListRecord(currentAgent, seeded);
        }
        setGroups(seeded);

        // Flatten all DIDs
        const addedAtMap = new Map<string, string>();
        for (const g of pdsGroups) {
          for (const m of g.members) {
            if (!addedAtMap.has(m.did)) addedAtMap.set(m.did, m.addedAt);
          }
        }
        const allDids = [...addedAtMap.keys()];

        if (allDids.length === 0) {
          setBuddies([]);
          setLoading(false);
          send({ type: 'sync_community', groups: seeded });
          const cachedVis = getCachedVisibility();
          send({ type: 'status_change', status: 'online', visibleTo: cachedVis });
          return;
        }

        const cfDids = new Set(
          pdsGroups
            .filter((g) => g.isInnerCircle === true)
            .flatMap((g) => g.members.map((m) => m.did)),
        );

        setBuddies(
          allDids.map((did) => ({
            did,
            status: 'offline',
            addedAt: addedAtMap.get(did) ?? new Date().toISOString(),
            isInnerCircle: cfDids.has(did),
          })),
        );
        setLoading(false);

        // Connect sequence
        send({ type: 'sync_community', groups: seeded });
        const cachedVis = getCachedVisibility();
        send({ type: 'status_change', status: 'online', visibleTo: cachedVis });
        send({ type: 'request_community_presence', dids: allDids });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agent, send, connected]);

  // Door event tracking (no sound yet — will add expo-av later)
  const triggerDoor = useCallback((did: string, event: DoorEvent) => {
    // TODO: play door sounds via expo-av
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
      if (!prev) return;
      const wasOnline = prev !== 'offline';
      const isOnline = newStatus !== 'offline';
      if (!wasOnline && isOnline) triggerDoor(did, 'join');
      else if (wasOnline && !isOnline) triggerDoor(did, 'leave');
    },
    [triggerDoor],
  );

  // Subscribe to community_presence WS events
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
      }
    });
    return unsub;
  }, [subscribe, checkTransition]);

  // Mutations
  const addBuddy = useCallback(
    async (did: string) => {
      if (!agent) return;
      const currentGroups = groupsRef.current;
      const now = new Date().toISOString();
      const newMember = { did, addedAt: now };

      const defaultGroup = currentGroups.find((g) => g.name === DEFAULT_GROUP);
      let updatedGroups: CommunityGroup[];
      if (defaultGroup) {
        if (defaultGroup.members.some((m) => m.did === did)) return;
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
        cfGroup = {
          name: INNER_CIRCLE_GROUP,
          isInnerCircle: true,
          members: [{ did, addedAt: new Date().toISOString() }],
        };
        updatedGroups = [...currentGroups, cfGroup];
      } else {
        const alreadyIn = cfGroup.members.some((m) => m.did === did);
        if (alreadyIn) {
          updatedGroups = currentGroups.map((g) =>
            g.name === INNER_CIRCLE_GROUP
              ? { ...g, members: g.members.filter((m) => m.did !== did) }
              : g,
          );
        } else {
          updatedGroups = currentGroups.map((g) =>
            g.name === INNER_CIRCLE_GROUP
              ? { ...g, members: [...g.members, { did, addedAt: new Date().toISOString() }] }
              : g,
          );
        }
      }

      setGroups(updatedGroups);
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

  // Cleanup door timers
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
    innerCircleDids,
  };
}
