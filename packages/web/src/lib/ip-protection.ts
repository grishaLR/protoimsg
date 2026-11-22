export type IpProtectionLevel = 'non-inner-circle' | 'all';

/** Snapshot of inner-circle DIDs for IP protection checks (set from RoomDirectoryPage) */
let innerCircleDidsSnapshot: ReadonlySet<string> = new Set();

export function setInnerCircleDidsForCalls(dids: ReadonlySet<string>) {
  innerCircleDidsSnapshot = dids;
}

export function getIpProtectionLevel(): IpProtectionLevel {
  const stored = localStorage.getItem('protoimsg:ipProtection');
  if (stored === 'non-inner-circle' || stored === 'all') return stored;
  return 'non-inner-circle';
}

/**
 * On localhost, only explicit 'all' forces relay — the 'non-inner-circle' default
 * would break local dev where coturn often isn't fully working.
 * Use ?forceRelay to test TURN locally regardless.
 */
const isLocalDev =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/** ?forceRelay=true in the URL forces TURN-only (no direct/STUN) for testing */
const forceRelay = new URLSearchParams(window.location.search).has('forceRelay');

/** `?forceRelay` is on: relay-only ICE everywhere (1:1, group calls, town voice). */
export function isForceRelay(): boolean {
  return forceRelay;
}

export function shouldForceRelayForDid(recipientDid: string): boolean {
  if (forceRelay) return true;
  const level = getIpProtectionLevel();
  if (isLocalDev) return false;
  if (level === 'all') return true;
  // 'non-inner-circle' — relay unless recipient is in inner circle
  return !innerCircleDidsSnapshot.has(recipientDid);
}
