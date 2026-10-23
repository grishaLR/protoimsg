import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { TOWN_VIEW, type TownProximityEvent } from '@protoimsg/shared';
import { BlockService } from '../moderation/block-service.js';
import type { TownVoice } from '../calls/town-voice.js';
import { TownRoom } from './town.js';

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
// Open public ground, and the centre square that stands in for home.
const OPEN = 200;
const ROW = 100;
const HOME_X = 20 * 48;
const HOME_Y = 15 * 48;

/** Every message of `type` a socket received. */
function sent(s: FakeWs, type: string): Array<{ type: string; data: unknown }> {
  return s.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as { type: string; data: unknown })
    .filter((m) => m.type === type);
}

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

  it('keeps voice off at home', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, HOME_X, HOME_Y, 0);
    town.join(b.ws, B, HOME_X + 20, HOME_Y, 0);
    await settle();
    expect(lastRoom(a)).toBeUndefined();
    expect(lastRoom(b)).toBeUndefined();
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

describe('TownRoom views (home privacy, area of interest, batching)', () => {
  let town: TownRoom;
  // Neighborhood ground just west of the home walls — within view of home.
  const NEAR_X = 12 * 48 + 24;
  const NEAR_Y = 15 * 48 + 24;
  const tick = () => vi.advanceTimersByTime(150);

  type View = {
    upsert: Array<{ did: string; x: number; y: number; dir: number }>;
    remove: string[];
  };
  const views = (s: FakeWs) => sent(s, 'town_view').map((m) => m.data as View);
  const upserted = (s: FakeWs) => views(s).flatMap((v) => v.upsert.map((p) => p.did));
  const removed = (s: FakeWs) => views(s).flatMap((v) => v.remove);

  beforeEach(() => {
    vi.useFakeTimers();
    const blocks = new BlockService();
    town = new TownRoom(blocks, null);
  });

  afterEach(() => {
    town.dispose();
    vi.useRealTimers();
  });

  it('never shows someone who is home, even right next to the walls', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, HOME_X, HOME_Y, 0);
    tick();
    expect(upserted(a)).not.toContain(B);

    const c = fakeWs();
    town.join(c.ws, C, NEAR_X + 20, NEAR_Y, 0);
    const state = sent(c, 'town_state')[0]?.data as { peers: Array<{ did: string }> };
    expect(state.peers.map((p) => p.did)).toEqual([A]);
  });

  it('stepping inside looks like leaving, stepping out like arriving', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, NEAR_X + 20, NEAR_Y, 0);
    tick();
    expect(upserted(a)).toContain(B);

    town.move(b.ws, HOME_X, HOME_Y, 0);
    tick();
    expect(removed(a)).toEqual([B]);

    a.send.mockClear();
    town.move(b.ws, HOME_X + 10, HOME_Y, 0);
    tick();
    expect(views(a)).toHaveLength(0);

    town.move(b.ws, NEAR_X + 30, NEAR_Y, 1);
    tick();
    expect(views(a).at(-1)?.upsert).toEqual([{ did: B, x: NEAR_X + 30, y: NEAR_Y, dir: 1 }]);
  });

  it('keeps chat at home to yourself', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, HOME_X, HOME_Y, 0);
    tick();
    town.chat(b.ws, 'hello?');
    expect(sent(a, 'town_chat')).toHaveLength(0);
    expect(sent(b, 'town_chat')).toHaveLength(1);
  });

  it('a second visible tab keeps the avatar alive when one tab goes home', () => {
    const a = fakeWs();
    const b1 = fakeWs();
    const b2 = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b1.ws, B, NEAR_X + 20, NEAR_Y, 0);
    town.join(b2.ws, B, NEAR_X + 40, NEAR_Y, 0);
    tick();
    town.move(b1.ws, HOME_X, HOME_Y, 0);
    tick();
    expect(removed(a)).not.toContain(B);
  });

  it('only sends avatars within your view, and removes them when they walk out', () => {
    const a = fakeWs();
    const far = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(far.ws, B, OPEN + TOWN_VIEW.halfWidth + 100, ROW, 0);
    tick();
    expect(upserted(a)).not.toContain(B);

    town.move(far.ws, OPEN + 100, ROW, 0);
    tick();
    expect(upserted(a)).toContain(B);

    town.move(far.ws, OPEN + TOWN_VIEW.halfWidth + 100, ROW, 0);
    tick();
    expect(removed(a)).toContain(B);
  });

  it('batches many moves into one message per viewer per tick', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, NEAR_X + 20, NEAR_Y, 0);
    tick();
    a.send.mockClear();
    for (let i = 1; i <= 5; i++) town.move(b.ws, NEAR_X + 20 + i, NEAR_Y, 0);
    tick();
    expect(views(a)).toHaveLength(1);
    expect(views(a)[0]?.upsert).toEqual([{ did: B, x: NEAR_X + 25, y: NEAR_Y, dir: 0 }]);
  });

  it('never shows a blocked user, and leaving town removes you', () => {
    const blocks = new BlockService();
    blocks.sync(A, [C]);
    town.dispose();
    town = new TownRoom(blocks, null);
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    town.join(a.ws, A, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, NEAR_X + 20, NEAR_Y, 0);
    town.join(c.ws, C, NEAR_X + 40, NEAR_Y, 0);
    tick();
    expect(upserted(a)).toContain(B);
    expect(upserted(a)).not.toContain(C);

    town.leave(b.ws);
    tick();
    expect(removed(a)).toContain(B);
  });
});
