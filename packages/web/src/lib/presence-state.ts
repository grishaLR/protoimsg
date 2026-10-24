// Presence state shared by everything that tells the server who you are
// online to: the status menu, the buddy list's connect sequence, and proto
// town. Plain module state (no React) so every sender reads the same values.

import type { PresenceVisibility } from '@protoimsg/shared';

const VISIBILITY_STORAGE_KEY = 'protoimsg:visibleTo';

export function getCachedVisibility(): PresenceVisibility {
  try {
    const stored = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (
      stored === 'everyone' ||
      stored === 'community' ||
      stored === 'inner-circle' ||
      stored === 'no-one'
    ) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'community';
}

// Most open first.
const VISIBILITY_ORDER: PresenceVisibility[] = ['everyone', 'community', 'inner-circle', 'no-one'];

function narrower(a: PresenceVisibility, b: PresenceVisibility): PresenceVisibility {
  return VISIBILITY_ORDER.indexOf(a) >= VISIBILITY_ORDER.indexOf(b) ? a : b;
}

/**
 * While you're in proto town, where you stand caps who sees you online (at
 * home: your inner circle). Every presence send narrows your own setting by
 * it — so a reconnect or a status change elsewhere in the app never quietly
 * widens it back. null = not in town.
 */
let townCap: PresenceVisibility | null = null;

export function setTownVisibilityCap(cap: PresenceVisibility | null): void {
  townCap = cap;
}

/** Who should see you online right now: your setting, narrowed by town. */
export function effectiveVisibility(): PresenceVisibility {
  const own = getCachedVisibility();
  return townCap ? narrower(own, townCap) : own;
}

export type SentStatus = 'online' | 'away' | 'idle';

/** Your current status, shared by everything that sends presence. */
let currentStatus: { status: SentStatus; awayMessage?: string } = { status: 'online' };

export function getCurrentStatus(): { status: SentStatus; awayMessage?: string } {
  return currentStatus;
}

export function setCurrentStatus(next: { status: SentStatus; awayMessage?: string }): void {
  currentStatus = next;
}

export function setCachedVisibility(v: PresenceVisibility): void {
  try {
    localStorage.setItem(VISIBILITY_STORAGE_KEY, v);
  } catch {
    // localStorage unavailable
  }
}
