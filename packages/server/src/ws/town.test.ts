import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { TownProximityEvent } from '@protoimsg/shared';
import { BlockService } from '../moderation/block-service.js';
import type { TownVoice } from '../calls/town-voice.js';
import { TownRoom, type TownCircles } from './town.js';

type Room = TownProximityEvent['data']['room'];

interface FakeWs {
  ws: WebSocket;
  send: ReturnType<typeof vi.fn>;
}

function fakeWs(): FakeWs {
  const send = vi.fn();
  return { ws: { readyState: 1, OPEN: 1, send } as unknown as WebSocket, send };
}

/** The latest proximity assignment a socket received (undefined = none yet). */
function lastRoom(s: FakeWs): Room | undefined {
  const msgs = s.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as { type: string; data: unknown })
    .filter((m) => m.type === 'town_proximity') as TownProximityEvent[];
  return msgs.at(-1)?.data.room;
}

function fakeVoice(participants: string[] = []) {
  return {
    url: 'wss://lk.test',
    ensureRoom: vi.fn(() => Promise.resolve()),
    issueToken: vi.fn((room: string, pid: string) => Promise.resolve(`tok:${room}:${pid}`)),
    removeParticipant: vi.fn<TownVoice['removeParticipant']>(),
    listParticipants: vi.fn(() => Promise.resolve(participants)),
  } satisfies TownVoice;
}

const A = 'did:plc:a';
const B = 'did:plc:b';
const C = 'did:plc:c';
// The top rows (tile y < 4) are open 'everyone' ground; the inner zone (not
// bedroom) is around tile (13, 15).
const OPEN = 200;
const ROW = 100;
const INNER_X = 13 * 48 + 24;
const INNER_Y = 15 * 48 + 24;

describe('TownRoom proximity voice', () => {
  let blocks: BlockService;
  let voice: ReturnType<typeof fakeVoice>;
  let town: TownRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    blocks = new BlockService();
    for (const d of [A, B, C]) blocks.sync(d, []);
    voice = fakeVoice();
    town = new TownRoom(blocks, voice);
  });

  afterEach(() => {
    town.dispose();
    vi.useRealTimers();
  });

  const settle = () => vi.advanceTimersByTimeAsync(1500);

  it('puts two nearby synced avatars in one room with a shared roster', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);
    await settle();

    const ra = lastRoom(a);
    const rb = lastRoom(b);
    expect(ra?.roomId).toBeDefined();
    expect(ra?.roomId).toBe(rb?.roomId);
    expect(ra?.members.map((m) => m.did).sort()).toEqual([A, B]);
    expect(ra?.selfPid).not.toBe(rb?.selfPid);
  });

  it('keeps voice off until the block list has synced (fail closed)', async () => {
    const unsynced = 'did:plc:new';
    const a = fakeWs();
    const u = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(u.ws, unsynced, OPEN + 20, ROW, 0);
    await settle();
    expect(lastRoom(u)).toBeUndefined();

    blocks.sync(unsynced, []);
    town.refreshProximity();
    await settle();
    expect(
      lastRoom(u)
        ?.members.map((m) => m.did)
        .sort(),
    ).toEqual([A, unsynced].sort());
  });

  it('never lets a blocked pair share a room through a bridge', async () => {
    blocks.sync(A, [C]);
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 80, ROW, 0);
    town.join(c.ws, C, OPEN + 160, ROW, 0);
    await settle();

    const ra = lastRoom(a);
    const rc = lastRoom(c);
    expect(ra?.roomId).not.toBe(rc?.roomId ?? null);
    expect(ra?.members.map((m) => m.did)).not.toContain(C);
  });

  it('splits an existing room when someone blocks mid-conversation', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);
    await settle();
    const pidB = lastRoom(b)?.selfPid;
    expect(pidB).toBeDefined();

    blocks.sync(A, [B]);
    town.refreshProximity();
    await settle();
    expect(lastRoom(a)).toBeNull();
    expect(lastRoom(b)).toBeNull();
    expect(voice.removeParticipant).toHaveBeenCalledWith(expect.any(String), pidB);
  });

  it('evicts the leaver and updates the remaining roster', async () => {
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);
    town.join(c.ws, C, OPEN + 40, ROW, 0);
    await settle();
    const roomId = lastRoom(a)?.roomId;
    const pidC = lastRoom(c)?.selfPid;

    town.leave(c.ws);
    await settle();
    expect(voice.removeParticipant).toHaveBeenCalledWith(roomId, pidC);
    expect(lastRoom(a)?.roomId).toBe(roomId);
    expect(
      lastRoom(a)
        ?.members.map((m) => m.did)
        .sort(),
    ).toEqual([A, B]);
  });

  it('gates the inner zone by inner circle, in both directions', async () => {
    const circles = new Map<string, TownCircles>([
      [A, { community: new Set(), inner: new Set([B]) }],
      [B, { community: new Set(), inner: new Set() }],
    ]);
    town.dispose();
    town = new TownRoom(blocks, voice, (d) =>
      Promise.resolve(circles.get(d) ?? { community: new Set(), inner: new Set() }),
    );
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, INNER_X, INNER_Y, 0);
    town.join(b.ws, B, INNER_X + 20, INNER_Y, 0);
    await settle();
    // B is in A's inner circle, but A is not in B's — B's zone says no.
    expect(lastRoom(a)).toBeUndefined();

    circles.set(B, { community: new Set(), inner: new Set([A]) });
    town.refreshCircles(B);
    await settle();
    expect(lastRoom(a)?.roomId).toBe(lastRoom(b)?.roomId);
  });

  it('reconciles out participants who are not on the roster', async () => {
    voice = fakeVoice(['p_intruder']);
    town.dispose();
    town = new TownRoom(blocks, voice);
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);
    await settle();
    expect(voice.removeParticipant).toHaveBeenCalledWith(lastRoom(a)?.roomId, 'p_intruder');
  });

  it('re-sends a fresh token when the client asks for a voice refresh', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);
    await settle();
    const before = a.send.mock.calls.length;

    town.refreshVoice(a.ws);
    await settle();
    expect(a.send.mock.calls.length).toBeGreaterThan(before);
    expect(lastRoom(a)?.token).toContain(lastRoom(a)?.selfPid ?? '?');
  });
});
