import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useWebSocket } from '../contexts/WebSocketContext';
import { getBuddyListRecord, putBuddyListRecord, generateTid } from '../lib/atproto';
import { fetchPresence } from '../lib/api';
import { playDoorOpen, playDoorClose } from '../lib/sounds';
import type { BuddyGroup } from '@chatmosphere/lexicon';
import type { BuddyWithPresence } from '../types';
import type { ServerMessage } from '@chatmosphere/shared';

export type DoorEvent = 'join' | 'leave';

const DEFAULT_GROUP = 'Buddies';
const CLOSE_FRIENDS_GROUP = 'Close Friends';
const PROTECTED_GROUPS = new Set([DEFAULT_GROUP, CLOSE_FRIENDS_GROUP]);
const MAX_GROUPS = 50;
const DOOR_LINGER_MS = 5000;

export function useBuddyList() {
  const { agent } = useAuth();
  const { send, subscribe } = useWebSocket();
  const [buddies, setBuddies] = useState<BuddyWithPresence[]>([]);
  const [doorEvents, setDoorEvents] = useState<Record<string, DoorEvent>>({});
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<BuddyGroup[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const doorTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Derive close-friend DIDs from groups (memoized to avoid recomputing on every render)
  const closeFriendDids = useMemo(
    () =>
      new Set(
        groups.filter((g) => g.isCloseFriends === true).flatMap((g) => g.members.map((m) => m.did)),
      ),
    [groups],
  );

  // Load buddy list from PDS + fetch presence
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!agent) return;

    cancelledRef.current = false;
    const currentAgent = agent;

    async function load() {
      const pdsGroups = await getBuddyListRecord(currentAgent);
      if (cancelledRef.current) return;
      setGroups(pdsGroups);

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
          .filter((g) => g.isCloseFriends === true)
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

      // Default all buddies to offline — WS request_buddy_presence
      // will deliver block-filtered presence shortly after
      setBuddies(
        allDids.map((did) => ({
          did,
          status: 'offline',
          addedAt: addedAtMap.get(did) ?? new Date().toISOString(),
          isCloseFriend: cfDids.has(did),
          blockRkey: blockMap.get(did),
        })),
      );
      setLoading(false);

      // Request block-filtered presence via WS
      send({ type: 'request_buddy_presence', dids: allDids });
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
      setDoorEvents((prev) => {
        const { [did]: _, ...rest } = prev;
        return rest;
      });
    }, DOOR_LINGER_MS);
    doorTimersRef.current.push(t);
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

  // Subscribe to presence + buddy_presence WS events
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'buddy_presence') {
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

      const now = new Date().toISOString();
      const newMember = { did, addedAt: now };

      // Update local groups
      let updatedGroups: BuddyGroup[];
      const defaultGroup = groups.find((g) => g.name === DEFAULT_GROUP);
      if (defaultGroup) {
        if (defaultGroup.members.some((m) => m.did === did)) return; // already exists
        updatedGroups = groups.map((g) =>
          g.name === DEFAULT_GROUP ? { ...g, members: [...g.members, newMember] } : g,
        );
      } else {
        updatedGroups = [...groups, { name: DEFAULT_GROUP, members: [newMember] }];
      }

      setGroups(updatedGroups);
      setBuddies((prev) => [...prev, { did, status: 'offline', addedAt: now }]);

      await putBuddyListRecord(agent, updatedGroups);

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
    [agent, groups],
  );

  const removeBuddy = useCallback(
    async (did: string) => {
      if (!agent) return;

      const updatedGroups = groups.map((g) => ({
        ...g,
        members: g.members.filter((m) => m.did !== did),
      }));

      setGroups(updatedGroups);
      setBuddies((prev) => prev.filter((b) => b.did !== did));

      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
  );

  const toggleCloseFriend = useCallback(
    async (did: string) => {
      if (!agent) return;

      let cfGroup = groups.find((g) => g.name === CLOSE_FRIENDS_GROUP);
      let updatedGroups: BuddyGroup[];

      if (!cfGroup) {
        // Create close friends group with this member
        cfGroup = {
          name: CLOSE_FRIENDS_GROUP,
          isCloseFriends: true,
          members: [{ did, addedAt: new Date().toISOString() }],
        };
        updatedGroups = [...groups, cfGroup];
      } else {
        const alreadyIn = cfGroup.members.some((m) => m.did === did);
        if (alreadyIn) {
          // Remove from close friends
          updatedGroups = groups.map((g) =>
            g.name === CLOSE_FRIENDS_GROUP
              ? { ...g, members: g.members.filter((m) => m.did !== did) }
              : g,
          );
        } else {
          // Add to close friends
          updatedGroups = groups.map((g) =>
            g.name === CLOSE_FRIENDS_GROUP
              ? { ...g, members: [...g.members, { did, addedAt: new Date().toISOString() }] }
              : g,
          );
        }
      }

      setGroups(updatedGroups);
      // Update buddy's isCloseFriend flag
      const newCfDids = new Set(
        updatedGroups
          .filter((g) => g.isCloseFriends === true)
          .flatMap((g) => g.members.map((m) => m.did)),
      );
      setBuddies((prev) => prev.map((b) => ({ ...b, isCloseFriend: newCfDids.has(b.did) })));

      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
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
      if (groups.some((g) => g.name === trimmed)) return;
      if (groups.length >= MAX_GROUPS) return;

      const updatedGroups = [...groups, { name: trimmed, members: [] }];
      setGroups(updatedGroups);
      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
  );

  const renameGroup = useCallback(
    async (oldName: string, newName: string) => {
      if (!agent) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      if (groups.some((g) => g.name === trimmed)) return;

      const updatedGroups = groups.map((g) => (g.name === oldName ? { ...g, name: trimmed } : g));
      setGroups(updatedGroups);
      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
  );

  const deleteGroup = useCallback(
    async (name: string) => {
      if (!agent) return;
      if (PROTECTED_GROUPS.has(name)) return;
      const group = groups.find((g) => g.name === name);
      if (!group || group.members.length > 0) return;

      const updatedGroups = groups.filter((g) => g.name !== name);
      setGroups(updatedGroups);
      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
  );

  const moveBuddy = useCallback(
    async (did: string, fromGroup: string, toGroup: string) => {
      if (!agent || fromGroup === toGroup) return;

      const updatedGroups = groups.map((g) => {
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
      await putBuddyListRecord(agent, updatedGroups);
    },
    [agent, groups],
  );

  // Cleanup door timers on unmount
  useEffect(() => {
    const timers = doorTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  return {
    buddies,
    groups,
    doorEvents,
    loading,
    addBuddy,
    removeBuddy,
    toggleCloseFriend,
    blockBuddy,
    closeFriendDids,
    agent,
    createGroup,
    renameGroup,
    deleteGroup,
    moveBuddy,
  };
}
