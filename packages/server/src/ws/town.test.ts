import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { TownProximityEvent } from '@protoimsg/shared';
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

describe('TownRoom home privacy', () => {
  let town: TownRoom;

  beforeEach(() => {
    const blocks = new BlockService();
    town = new TownRoom(blocks, null);
  });

  afterEach(() => {
    town.dispose();
  });

  it('does not announce or list someone who is home', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, HOME_X, HOME_Y, 0);
    expect(sent(a, 'town_peer_join')).toHaveLength(0);

    const c = fakeWs();
    town.join(c.ws, C, OPEN, ROW, 0);
    const state = sent(c, 'town_state')[0]?.data as { peers: Array<{ did: string }> };
    expect(state.peers.map((p) => p.did)).toEqual([A]);
  });

  it('stepping inside looks like leaving, stepping out like arriving', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, OPEN + 20, ROW, 0);

    town.move(b.ws, HOME_X, HOME_Y, 0);
    expect(sent(a, 'town_peer_leave')).toEqual([{ type: 'town_peer_leave', data: { did: B } }]);

    town.move(b.ws, HOME_X + 10, HOME_Y, 0);
    expect(sent(a, 'town_peer_move')).toHaveLength(0);

    town.move(b.ws, OPEN, ROW, 1);
    expect(sent(a, 'town_peer_join').at(-1)?.data).toEqual({ did: B, x: OPEN, y: ROW, dir: 1 });
  });

  it('keeps chat at home to yourself', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b.ws, B, HOME_X, HOME_Y, 0);
    town.chat(b.ws, 'hello?');
    expect(sent(a, 'town_chat')).toHaveLength(0);
    expect(sent(b, 'town_chat')).toHaveLength(1);
  });

  it('a second visible tab keeps the avatar alive when one tab goes home', () => {
    const a = fakeWs();
    const b1 = fakeWs();
    const b2 = fakeWs();
    town.join(a.ws, A, OPEN, ROW, 0);
    town.join(b1.ws, B, OPEN + 20, ROW, 0);
    town.join(b2.ws, B, OPEN + 40, ROW, 0);
    town.move(b1.ws, HOME_X, HOME_Y, 0);
    expect(sent(a, 'town_peer_leave')).toHaveLength(0);
  });
});
