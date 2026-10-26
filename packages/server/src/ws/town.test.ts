import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import {
  TOWN_DEFAULT_LAYOUT,
  TOWN_PROXIMITY,
  TOWN_TILE,
  TOWN_VIEW,
  parseTownSceneId,
  townArrival,
  townGateArrival,
  type TownProximityEvent,
  type TownVoiceMember,
  type TownVoiceRoomEvent,
} from '@protoimsg/shared';
import { BlockService } from '../moderation/block-service.js';
import type { TownVoice } from '../calls/town-voice.js';
import { TownRoom } from './town.js';
import { CommunityTownGraph } from './town-graph.js';

type Convo = TownProximityEvent['data']['conversation'];
type Voice = TownVoiceRoomEvent['data']['voice'];

interface FakeWs {
  ws: WebSocket;
  send: ReturnType<typeof vi.fn>;
}

function fakeWs(): FakeWs {
  const send = vi.fn();
  return { ws: { readyState: 1, OPEN: 1, send } as unknown as WebSocket, send };
}

/**
 * The latest conversation roster a socket received (undefined = none yet),
 * with its id as `roomId`.
 */
function lastRoom(s: FakeWs): { roomId: string; members: TownVoiceMember[] } | null | undefined {
  const msgs = s.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as { type: string; data: unknown })
    .filter((m) => m.type === 'town_proximity') as TownProximityEvent[];
  if (msgs.length === 0) return undefined;
  const c: Convo | undefined = msgs.at(-1)?.data.conversation;
  return c ? { roomId: c.id, members: c.members } : null;
}

/** The latest scene voice assignment a socket received (undefined = none yet). */
function lastVoice(s: FakeWs): Voice | undefined {
  const msgs = s.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as { type: string; data: unknown })
    .filter((m) => m.type === 'town_voice_room') as TownVoiceRoomEvent[];
  return msgs.at(-1)?.data.voice;
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
// Open ground in the square; scenes share coordinates but nothing else.
const OPEN = 200;
const ROW = 100;
const SQ = 'square';
const homeOf = (did: string) => `home:${did}`;

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
  const AUDIO = { on: true };

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
  const dids = (s: FakeWs) =>
    lastRoom(s)
      ?.members.map((m) => m.did)
      .sort();

  it('puts two nearby synced avatars in one conversation with a shared roster', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0);
    await settle();

    expect(lastRoom(a)?.roomId).toBeDefined();
    expect(lastRoom(a)?.roomId).toBe(lastRoom(b)?.roomId);
    expect(dids(a)).toEqual([A, B]);
    // Nobody joined audio: no voice room, no LiveKit identities.
    expect(lastVoice(a)).toBeUndefined();
    expect(lastRoom(a)?.members.every((m) => m.pid === '')).toBe(true);
  });

  it('joining audio gives one shared voice room per scene, and rosters carry identities', async () => {
    const a = fakeWs();
    const b = fakeWs();
    const far = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    town.join(far.ws, C, SQ, OPEN + 600, ROW, 0, false, AUDIO);
    await settle();

    const va = lastVoice(a);
    const vb = lastVoice(b);
    expect(va?.room).toBeTruthy();
    // Everyone in the scene shares it — even someone nowhere near.
    expect(vb?.room).toBe(va?.room);
    expect(lastVoice(far)?.room).toBe(va?.room);
    expect(va?.selfPid).not.toBe(vb?.selfPid);
    expect(va?.token).toBe(`tok:${va?.room ?? ''}:${va?.selfPid ?? ''}`);
    // ...but only the conversation is on the roster.
    expect(lastRoom(a)?.members).toEqual(
      expect.arrayContaining([
        { did: A, pid: va?.selfPid },
        { did: B, pid: vb?.selfPid },
      ]),
    );
    expect(dids(a)).toEqual([A, B]);
    expect(lastRoom(far)).toBeUndefined();
  });

  it('joins and leaves audio mid-session', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0);
    await settle();
    expect(lastRoom(a)?.members.find((m) => m.did === B)?.pid).toBe('');

    town.setVoiceWanted(b.ws, true);
    await settle();
    const pidB = lastVoice(b)?.selfPid;
    expect(pidB).toBeTruthy();
    expect(lastRoom(a)?.members.find((m) => m.did === B)?.pid).toBe(pidB);

    town.setVoiceWanted(b.ws, false);
    await settle();
    expect(lastVoice(b)).toBeNull();
    expect(voice.removeParticipant).toHaveBeenCalledWith(expect.any(String), pidB);
    expect(lastRoom(a)?.members.find((m) => m.did === B)?.pid).toBe('');
  });

  it('keeps conversations off until the block list has synced (fail closed)', async () => {
    const unsynced = 'did:plc:new';
    const a = fakeWs();
    const u = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(u.ws, unsynced, SQ, OPEN + 20, ROW, 0);
    await settle();
    expect(lastRoom(u)).toBeUndefined();

    blocks.sync(unsynced, []);
    town.refreshBlocks();
    await settle();
    expect(dids(u)).toEqual([A, unsynced].sort());
  });

  it('never lets a blocked pair share a conversation through a bridge', async () => {
    blocks.sync(A, [C]);
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(b.ws, B, SQ, OPEN + 80, ROW, 0);
    town.join(c.ws, C, SQ, OPEN + 160, ROW, 0);
    await settle();

    expect(lastRoom(a)?.roomId).not.toBe(lastRoom(c)?.roomId ?? null);
    expect(dids(a)).not.toContain(C);
  });

  it('splits a conversation when someone blocks mid-conversation', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    await settle();
    expect(lastRoom(a)).toBeTruthy();

    blocks.sync(A, [B]);
    town.refreshBlocks();
    await settle();
    expect(lastRoom(a)).toBeNull();
    expect(lastRoom(b)).toBeNull();
  });

  it('evicts someone who leaves town and updates the remaining roster', async () => {
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    town.join(c.ws, C, SQ, OPEN + 40, ROW, 0, false, AUDIO);
    await settle();
    const roomId = lastRoom(a)?.roomId;
    const vc = lastVoice(c);

    town.leave(c.ws);
    await settle();
    expect(voice.removeParticipant).toHaveBeenCalledWith(vc?.room, vc?.selfPid);
    expect(lastRoom(a)?.roomId).toBe(roomId);
    expect(dids(a)).toEqual([A, B]);
  });

  it('a dropped socket keeps its voice identity briefly and resumes it on reconnect', async () => {
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    const v = lastVoice(a);
    expect(v?.selfPid).toBeTruthy();

    town.leave(a.ws, true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(voice.removeParticipant).not.toHaveBeenCalled();

    const a2 = fakeWs();
    town.join(a2.ws, A, SQ, OPEN, ROW, 0, false, { on: true, pid: v?.selfPid });
    await settle();
    expect(lastVoice(a2)).toMatchObject({ room: v?.room, selfPid: v?.selfPid });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(voice.removeParticipant).not.toHaveBeenCalledWith(v?.room, v?.selfPid);
  });

  it('a parked identity lapses, and nobody else can claim it', async () => {
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    const v = lastVoice(a);

    town.leave(a.ws, true);
    const b = fakeWs();
    town.join(b.ws, B, SQ, OPEN, ROW, 0, false, { on: true, pid: v?.selfPid });
    await settle();
    expect(lastVoice(b)?.selfPid).not.toBe(v?.selfPid);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(voice.removeParticipant).toHaveBeenCalledWith(v?.room, v?.selfPid);
  });

  it('never shares a conversation or voice room across scenes', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, homeOf(B), OPEN, ROW, 0, false, AUDIO);
    await settle();
    expect(lastRoom(a)).toBeUndefined();
    expect(lastRoom(b)).toBeUndefined();
    expect(lastVoice(a)?.room).not.toBe(lastVoice(b)?.room);
  });

  it('drops the conversation and voice room the moment you walk through a door', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    await settle();
    const before = lastVoice(a);
    expect(lastRoom(a)).toBeTruthy();

    town.join(a.ws, A, homeOf(A), OPEN, ROW, 0, false, AUDIO);
    expect(lastRoom(a)).toBeNull();
    expect(voice.removeParticipant).toHaveBeenCalledWith(before?.room, before?.selfPid);
    await settle();
    expect(lastVoice(a)?.room).not.toBe(before?.room);
    expect(lastVoice(a)?.selfPid).not.toBe(before?.selfPid);
    expect(lastRoom(b)).toBeNull();
  });

  it('keeps a link for a short grace past the leave radius', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0);
    await settle();
    const id = lastRoom(a)?.roomId;

    town.move(b.ws, OPEN + TOWN_PROXIMITY.leaveRadius + 40, ROW, 0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(lastRoom(a)?.roomId).toBe(id);
    // Back within range before the grace ends: the same conversation carries on.
    town.move(b.ws, OPEN + 20, ROW, 0);
    await settle();
    expect(lastRoom(a)?.roomId).toBe(id);

    town.move(b.ws, OPEN + TOWN_PROXIMITY.leaveRadius + 40, ROW, 0);
    await vi.advanceTimersByTimeAsync(TOWN_PROXIMITY.linkGraceMs + 500);
    expect(lastRoom(a)).toBeNull();
  });

  it('"stay together" holds a link at any distance only while both chose it', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0);
    await settle();
    const id = lastRoom(a)?.roomId;

    town.setStay(a.ws, true);
    town.setStay(b.ws, true);
    await settle();
    expect(lastRoom(a)?.members.every((m) => m.stay)).toBe(true);
    town.move(b.ws, OPEN + 700, ROW, 0);
    await vi.advanceTimersByTimeAsync(TOWN_PROXIMITY.linkGraceMs + 1500);
    expect(lastRoom(a)?.roomId).toBe(id);

    town.setStay(b.ws, false);
    await vi.advanceTimersByTimeAsync(TOWN_PROXIMITY.linkGraceMs + 1500);
    expect(lastRoom(a)).toBeNull();
    // A choice about that conversation only: a new one starts without it.
    town.move(b.ws, OPEN + 20, ROW, 0);
    await settle();
    expect(lastRoom(a)?.members.some((m) => m.stay)).toBe(false);
  });

  it('replaces the voice identity of someone who blocks a person who knew it', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    await settle();
    const oldA = lastVoice(a)?.selfPid;
    const oldB = lastVoice(b)?.selfPid;
    // B learned A's identity from its roster.
    expect(lastRoom(b)?.members.some((m) => m.pid === oldA)).toBe(true);

    blocks.sync(A, [B]);
    town.refreshBlocks();
    await settle();
    // Both shared rooms are scene-wide: neither may keep following the other.
    expect(lastVoice(a)?.selfPid).not.toBe(oldA);
    expect(lastVoice(b)?.selfPid).not.toBe(oldB);
    expect(voice.removeParticipant).toHaveBeenCalledWith(lastVoice(a)?.room, oldA);
  });

  it('never resumes a parked identity across a block that landed meanwhile', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    await settle();
    const v = lastVoice(a);

    town.leave(a.ws, true);
    blocks.sync(A, [B]);
    town.refreshBlocks();
    const a2 = fakeWs();
    town.join(a2.ws, A, SQ, OPEN, ROW, 0, false, { on: true, pid: v?.selfPid });
    await settle();
    expect(lastVoice(a2)?.selfPid).not.toBe(v?.selfPid);
    expect(voice.removeParticipant).toHaveBeenCalledWith(v?.room, v?.selfPid);
  });

  it('a reconnect takes its identity over from a socket the server still thinks is alive', async () => {
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    const v = lastVoice(a);

    const a2 = fakeWs();
    town.join(a2.ws, A, SQ, OPEN, ROW, 0, false, { on: true, pid: v?.selfPid });
    await settle();
    expect(lastVoice(a2)?.selfPid).toBe(v?.selfPid);
    // The dead socket closing later doesn't evict the identity it gave up.
    town.leave(a.ws);
    expect(voice.removeParticipant).not.toHaveBeenCalledWith(v?.room, v?.selfPid);
  });

  it('stops re-issuing tokens after a few tries until the client asks again', async () => {
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const capped = voice.issueToken.mock.calls.length;
    expect(capped).toBe(1 + 4);
    town.refreshVoice(a.ws);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(voice.issueToken.mock.calls.length).toBeGreaterThan(capped + 1);
  });

  it('reconciles out participants who are not in the scene', async () => {
    voice = fakeVoice(['p_intruder']);
    town.dispose();
    town = new TownRoom(blocks, voice);
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(voice.removeParticipant).toHaveBeenCalledWith(lastVoice(a)?.room, 'p_intruder');
  });

  it('re-issues a token to someone who never showed up in the voice room', async () => {
    const a = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    await settle();
    expect(voice.issueToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(voice.issueToken.mock.calls.length).toBeGreaterThan(1);
    expect(voice.issueToken).toHaveBeenLastCalledWith(lastVoice(a)?.room, lastVoice(a)?.selfPid);
  });

  it('a voice refresh sends a fresh token to the asker only', async () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0, false, AUDIO);
    town.join(b.ws, B, SQ, OPEN + 20, ROW, 0, false, AUDIO);
    await settle();
    const tokensB = sent(b, 'town_voice_room').length;
    const tokensA = sent(a, 'town_voice_room').length;

    town.refreshVoice(a.ws);
    await settle();
    expect(sent(a, 'town_voice_room').length).toBe(tokensA + 1);
    expect(sent(b, 'town_voice_room').length).toBe(tokensB);
    expect(lastRoom(a)).toBeTruthy();
  });
});

describe('TownRoom views (scene privacy, area of interest, batching)', () => {
  let town: TownRoom;
  const NEAR_X = 12 * 48 + 24;
  const NEAR_Y = 15 * 48 + 24;
  const tick = () => vi.advanceTimersByTime(150);

  type View = {
    upsert: Array<{ did: string; x: number; y: number; dir: number }>;
    remove: string[];
  };
  type State = {
    scene: string;
    self: { x: number; y: number };
    peers: Array<{ did: string }>;
    reason?: string;
  };
  const views = (s: FakeWs) => sent(s, 'town_view').map((m) => m.data as View);
  const upserted = (s: FakeWs) => views(s).flatMap((v) => v.upsert.map((p) => p.did));
  const removed = (s: FakeWs) => views(s).flatMap((v) => v.remove);
  const lastState = (s: FakeWs) => sent(s, 'town_state').at(-1)?.data as State | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    const blocks = new BlockService();
    town = new TownRoom(blocks, null);
  });

  afterEach(() => {
    town.dispose();
    vi.useRealTimers();
  });

  it('never shows someone in another scene, even at the same coordinates', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, homeOf(B), NEAR_X, NEAR_Y, 0);
    tick();
    expect(upserted(a)).not.toContain(B);

    const c = fakeWs();
    town.join(c.ws, C, SQ, NEAR_X + 20, NEAR_Y, 0);
    expect(lastState(c)?.peers.map((p) => p.did)).toEqual([A]);
  });

  it('walking through a door looks like leaving, coming back like arriving', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    tick();
    expect(upserted(a)).toContain(B);

    town.join(b.ws, B, homeOf(B), 200, 200, 0);
    tick();
    expect(removed(a)).toEqual([B]);
    expect(lastState(b)?.peers).toEqual([]);

    a.send.mockClear();
    town.move(b.ws, 210, 200, 0);
    tick();
    expect(views(a)).toHaveLength(0);

    // Back out: the server places B at the square's arrival point, wherever
    // B's client claims to be.
    town.move(a.ws, 960, 200, 0);
    town.join(b.ws, B, SQ, 5, 5, 1);
    tick();
    expect(views(a).at(-1)?.upsert).toEqual([{ did: B, ...townArrival('square', 'home') }]);
  });

  it('keeps chat inside the scene', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, homeOf(B), NEAR_X, NEAR_Y, 0);
    tick();
    town.chat(b.ws, 'hello?');
    expect(sent(a, 'town_chat')).toHaveLength(0);
    expect(sent(b, 'town_chat')).toHaveLength(1);
  });

  it('a second tab in the square keeps the avatar alive when one tab goes home', () => {
    const a = fakeWs();
    const b1 = fakeWs();
    const b2 = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b1.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    town.join(b2.ws, B, SQ, NEAR_X + 40, NEAR_Y, 0);
    tick();
    town.join(b1.ws, B, homeOf(B), 200, 200, 0);
    tick();
    expect(removed(a)).not.toContain(B);
  });

  it("refuses someone else's home or neighborhood and leaves you where you were", () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    tick();
    for (const scene of [homeOf(B), `neighborhood:${B}`, 'home:not-a-did', 'lobby']) {
      town.join(a.ws, A, scene, NEAR_X, NEAR_Y, 0);
      expect(sent(a, 'town_denied').at(-1)?.data).toEqual({ scene });
    }
    expect(lastState(a)?.scene).toBe(SQ);
    town.chat(a.ws, 'still here');
    expect(sent(b, 'town_chat')).toHaveLength(1);
  });

  it('keeps chat in the old scene the instant you walk through a door', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    tick();
    // A still "knows" B until the next view tick — the scene check must hold.
    town.join(b.ws, B, homeOf(B), 200, 200, 0);
    town.chat(b.ws, 'inside now');
    expect(sent(a, 'town_chat')).toHaveLength(0);
  });

  it('a refused (re)join lands you at home and says why, never nowhere', () => {
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, `neighborhood:${A}`, NEAR_X, NEAR_Y, 0);
    expect(lastState(b)).toMatchObject({ scene: homeOf(B), reason: 'removed' });
    town.chat(b.ws, 'hi');
    tick();
    expect(upserted(a)).not.toContain(B);
    expect(sent(a, 'town_chat')).toHaveLength(0);
  });

  it('clamps moves to the bounds of the scene you are in', () => {
    // Square is 40×30 tiles: the far corner you can stand on is tile 39, 29.
    const edgeX = 39 * TOWN_TILE;
    const edgeY = 29 * TOWN_TILE;
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, edgeX - 100, edgeY - 100, 0);
    town.join(b.ws, B, SQ, edgeX - 50, edgeY - 50, 0);
    tick();
    town.move(a.ws, 5000, 5000, 0);
    tick();
    expect(views(b).at(-1)?.upsert).toEqual([{ did: A, x: edgeX, y: edgeY, dir: 0 }]);
  });

  it('hides a newly blocked avatar without waiting for anyone to move', () => {
    const blocks = new BlockService();
    town.dispose();
    town = new TownRoom(blocks, null);
    const a = fakeWs();
    const b = fakeWs();
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    tick();
    expect(upserted(a)).toContain(B);
    blocks.sync(A, [B]);
    town.refreshBlocks();
    tick();
    expect(removed(a)).toContain(B);
  });

  it('joins your own home when no scene is given (fail closed)', () => {
    const a = fakeWs();
    town.join(a.ws, A, undefined, 200, 200, 0);
    expect(lastState(a)?.scene).toBe(homeOf(A));
  });

  it("clamps positions to the scene's bounds", () => {
    const a = fakeWs();
    town.join(a.ws, A, homeOf(A), 5000, 5000, 0);
    // Home is 14×10 tiles; you stay one tile in from the edge.
    expect(lastState(a)?.self).toMatchObject({ x: 13 * TOWN_TILE, y: 9 * TOWN_TILE });
  });

  it('only sends avatars within your view, and removes them when they walk out', () => {
    const a = fakeWs();
    const far = fakeWs();
    town.join(a.ws, A, SQ, OPEN, ROW, 0);
    town.join(far.ws, B, SQ, OPEN + TOWN_VIEW.halfWidth + 100, ROW, 0);
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
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
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
    town.join(a.ws, A, SQ, NEAR_X, NEAR_Y, 0);
    town.join(b.ws, B, SQ, NEAR_X + 20, NEAR_Y, 0);
    town.join(c.ws, C, SQ, NEAR_X + 40, NEAR_Y, 0);
    tick();
    expect(upserted(a)).toContain(B);
    expect(upserted(a)).not.toContain(C);

    town.leave(b.ws);
    tick();
    expect(removed(a)).toContain(B);
  });
});

describe('parseTownSceneId', () => {
  it('accepts the three scene shapes', () => {
    expect(parseTownSceneId('square')).toEqual({ kind: 'square' });
    expect(parseTownSceneId(`home:${A}`)).toEqual({ kind: 'home', owner: A });
    expect(parseTownSceneId('neighborhood:did:web:example.com')).toEqual({
      kind: 'neighborhood',
      owner: 'did:web:example.com',
    });
  });

  it('rejects anything malformed', () => {
    for (const id of [
      'square:',
      'Square',
      'home:',
      'home:did:plc:',
      'home:did:plc:a%',
      `home:${A}\n`,
      `home:did:plc:${'a'.repeat(2100)}`,
      `lobby:${A}`,
      '',
    ]) {
      expect(parseTownSceneId(id)).toBeNull();
    }
  });
});

describe('TownRoom with relationships (visiting, mutuals, gates, friends of friends)', () => {
  const D = 'did:plc:d';
  let blocks: BlockService;
  let graph: CommunityTownGraph;
  let town: TownRoom;
  let lists: Record<string, string[]>;
  /** Owner → their inner circle (a subset of their list). */
  let inner: Record<string, string[]>;
  const tick = () => vi.advanceTimersByTime(150);
  const nbhd = (owner: string) => `neighborhood:${owner}`;

  type State = {
    scene: string;
    self: { x: number; y: number; dir: number };
    peers: Array<{ did: string }>;
    gates?: Array<{ owner: string; slot: number }>;
    moreGates?: string[];
    canKnock?: boolean;
    knockingOpen?: boolean;
    windowLit?: boolean;
    reason?: string;
  };
  const lastState = (s: FakeWs) => sent(s, 'town_state').at(-1)?.data as State | undefined;
  const upserted = (s: FakeWs) =>
    sent(s, 'town_view').flatMap((m) =>
      (m.data as { upsert: Array<{ did: string }> }).upsert.map((p) => p.did),
    );
  /** Everyone a socket has been shown: its initial state plus later view diffs. */
  const seen = (s: FakeWs) => [
    ...sent(s, 'town_state').flatMap((m) => (m.data as State).peers.map((p) => p.did)),
    ...upserted(s),
  ];
  const removed = (s: FakeWs) =>
    sent(s, 'town_view').flatMap((m) => (m.data as { remove: string[] }).remove);

  beforeEach(() => {
    vi.useFakeTimers();
    blocks = new BlockService();
    for (const d of [A, B, C, D]) blocks.sync(d, []);
    // A lists B and C; B and C list A (mutuals with A) but not each other.
    lists = { [A]: [B, C], [B]: [A], [C]: [A], [D]: [] };
    // B is in A's inner circle; C is only in A's community.
    inner = { [A]: [B] };
    graph = new CommunityTownGraph({
      loadMembers: (d) => Promise.resolve(new Set(lists[d] ?? [])),
      loadInnerOwners: (d, owners) =>
        Promise.resolve(new Set([...owners].filter((o) => (inner[o] ?? []).includes(d)))),
      loadOwners: (d) =>
        Promise.resolve(new Set(Object.keys(lists).filter((o) => (lists[o] ?? []).includes(d)))),
    });
    town = new TownRoom(blocks, null, graph);
  });

  afterEach(() => {
    town.dispose();
    graph.dispose();
    vi.useRealTimers();
  });

  async function enter(s: FakeWs, did: string, scene: string, x = 300, y = 300) {
    await town.enter(s.ws, did, scene, x, y, 0);
  }

  it("lets you into a neighborhood only if you're on its owner's list", async () => {
    const b = fakeWs();
    const d = fakeWs();
    await enter(b, B, nbhd(A));
    await enter(d, D, nbhd(A));
    expect(lastState(b)?.scene).toBe(nbhd(A));
    // Not on the list: a first join lands you at home instead.
    expect(lastState(d)).toMatchObject({ scene: `home:${D}`, reason: 'removed' });
  });

  it('in a neighborhood you see the owner and your mutuals, nobody else', async () => {
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    await enter(a, A, nbhd(A));
    await enter(b, B, nbhd(A), 320);
    await enter(c, C, nbhd(A), 340);
    tick();
    expect(seen(a)).toEqual(expect.arrayContaining([B, C])); // owner sees all
    expect(seen(b)).toContain(A);
    expect(seen(b)).not.toContain(C); // B and C aren't mutuals
    expect(seen(c)).not.toContain(B);

    // B and C add each other: now they see each other.
    lists[B] = [A, C];
    lists[C] = [A, B];
    town.communityChanged(B, lists[B], []);
    town.communityChanged(C, lists[C], []);
    tick();
    expect(upserted(b)).toContain(C);
  });

  it('removing a visitor from your list walks them out to the square', async () => {
    const a = fakeWs();
    const b = fakeWs();
    await enter(a, A, nbhd(A));
    await enter(b, B, nbhd(A), 320);
    tick();
    town.communityChanged(A, [C], []);
    tick();
    expect(lastState(b)).toMatchObject({ scene: 'square', reason: 'removed' });
    expect(removed(a)).toContain(B);
  });

  it('blocking a visitor walks them out too', async () => {
    const a = fakeWs();
    const b = fakeWs();
    await enter(a, A, nbhd(A));
    await enter(b, B, nbhd(A), 320);
    blocks.sync(A, [B]);
    town.refreshBlocks();
    expect(lastState(b)).toMatchObject({ scene: 'square', reason: 'removed' });
  });

  it('gives you a gate row in the square: yours in the middle, then theirs', async () => {
    const b = fakeWs();
    await enter(b, B, 'square');
    expect(lastState(b)?.gates).toEqual([
      { owner: B, slot: 4 },
      { owner: A, slot: 3 },
    ]);
    // D adds B: B's row updates live.
    lists[D] = [B];
    town.communityChanged(D, [B], []);
    const update = sent(b, 'town_gates').at(-1)?.data as { gates: Array<{ owner: string }> };
    expect(update.gates.map((g) => g.owner)).toEqual([B, A, D]);
  });

  it("walking out of someone's neighborhood lands you below their gate", async () => {
    const b = fakeWs();
    await enter(b, B, nbhd(A));
    await enter(b, B, 'square', 5, 5);
    expect(lastState(b)?.self).toEqual(townGateArrival(3));
  });

  it('friends-of-friends mode hides strangers both ways, keeps friends of friends', async () => {
    // B ⇄ A ⇄ C: B and C are friends of friends through A; D is a stranger.
    const b = fakeWs();
    const c = fakeWs();
    const d = fakeWs();
    await enter(b, B, 'square', 300, 300);
    town.setFof(b.ws, true);
    await enter(c, C, 'square', 320, 300);
    await enter(d, D, 'square', 340, 300);
    tick();
    expect(seen(b)).toContain(C);
    expect(seen(b)).not.toContain(D);
    expect(seen(d)).not.toContain(B);
    expect(seen(d)).toContain(C); // C hasn't narrowed

    town.setFof(b.ws, false);
    tick();
    expect(seen(d)).toContain(B);
  });

  it("keeps an offline owner's gate shut until their block list says you're not blocked", async () => {
    // A is offline: A's blocks aren't synced, so the server reads A's public list.
    blocks = new BlockService();
    for (const d of [B, C, D]) blocks.sync(d, []);
    let aBlocks: Set<string> | null = null;
    const ownerBlocks = {
      blocks: (owner: string, did: string) => (owner === A && aBlocks ? aBlocks.has(did) : null),
      prefetch: vi.fn(),
      onLoaded: undefined as (() => void) | undefined,
    };
    town.dispose();
    town = new TownRoom(blocks, null, graph, ownerBlocks);
    const b = fakeWs();
    const c = fakeWs();
    await enter(b, B, 'square');
    expect(lastState(b)?.gates?.map((g) => g.owner)).toEqual([B]); // unknown → hidden
    expect(ownerBlocks.prefetch).toHaveBeenCalledWith([A]);
    await enter(b, B, nbhd(A));
    expect(sent(b, 'town_denied')).toHaveLength(1);

    // A's list loads: A blocked C, not B.
    aBlocks = new Set([C]);
    ownerBlocks.onLoaded?.();
    const row = sent(b, 'town_gates').at(-1)?.data as { gates: Array<{ owner: string }> };
    expect(row.gates.map((g) => g.owner)).toEqual([B, A]);
    await enter(b, B, nbhd(A));
    expect(lastState(b)?.scene).toBe(nbhd(A));
    await enter(c, C, nbhd(A));
    expect(lastState(c)).toMatchObject({ scene: `home:${C}`, reason: 'removed' });
  });

  it("orders gates mutuals first, then by name — never by who's online", async () => {
    // D is listed by A..C and 7 more; only A is a mutual of D.
    const extra = Array.from({ length: 7 }, (_, i) => `did:plc:x${String(i)}`);
    for (const o of [A, B, C, ...extra]) lists[o] = [...(lists[o] ?? []), D];
    lists[D] = [A];
    for (const o of extra) blocks.sync(o, []);
    const d = fakeWs();
    await enter(d, D, 'square');
    const before = lastState(d);
    // Someone listing D comes online; D re-enters: same order.
    const x = fakeWs();
    await enter(x, extra[6] ?? '', 'square');
    await enter(d, D, 'square');
    expect(lastState(d)?.gates).toEqual(before?.gates);
    expect(lastState(d)?.moreGates).toEqual(before?.moreGates);
    expect(before?.gates?.[1]?.owner).toBe(A); // the mutual gets the first slot
  });

  it('two visitors who are not mutuals never share voice in a neighborhood', async () => {
    const voice = fakeVoice();
    town.dispose();
    town = new TownRoom(blocks, voice, graph);
    const b = fakeWs();
    const c = fakeWs();
    await enter(b, B, nbhd(A), 300, 300);
    await enter(c, C, nbhd(A), 310, 300);
    await vi.advanceTimersByTimeAsync(1500);
    expect(lastRoom(b)).toBeUndefined();
    expect(lastRoom(c)).toBeUndefined();
  });

  it('turning on friends-of-friends stops a stranger’s chat at once', async () => {
    const b = fakeWs();
    const d = fakeWs();
    await enter(b, B, 'square', 300, 300);
    await enter(d, D, 'square', 320, 300);
    tick();
    town.setFof(b.ws, true);
    town.chat(d.ws, 'hey'); // before any view tick
    expect(sent(b, 'town_chat')).toHaveLength(0);
  });

  it('applies friends-of-friends from the join itself', async () => {
    const b = fakeWs();
    const d = fakeWs();
    await enter(d, D, 'square', 320, 300);
    await town.enter(b.ws, B, 'square', 300, 300, 0, true);
    expect(lastState(b)?.peers.map((p) => p.did)).not.toContain(D);
  });

  it('a refused or abandoned first join gives back what it loaded', async () => {
    const d = fakeWs();
    await enter(d, D, nbhd(A)); // denied
    const closed = fakeWs();
    (closed.ws as { readyState: number }).readyState = 3;
    await enter(closed, B, 'square');
    expect(graph.gatesFor(D).size).toBe(0);
    expect(graph.gatesFor(B).size).toBe(0);
  });

  describe('knocking', () => {
    const home = (owner: string) => `home:${owner}`;
    const requests = (s: FakeWs) =>
      sent(s, 'town_knock_request').map((m) => m.data as { knockId: string; from: string });

    async function setup() {
      const a = fakeWs(); // A, home
      const b = fakeWs(); // B, inner circle, outside A's door
      await enter(a, A, home(A));
      await enter(b, B, nbhd(A));
      return { a, b };
    }

    it('tells visitors whether they can knock (inner circle only)', async () => {
      const b = fakeWs();
      const c = fakeWs();
      await enter(b, B, nbhd(A));
      await enter(c, C, nbhd(A));
      expect(lastState(b)?.canKnock).toBe(true);
      expect(lastState(c)?.canKnock).toBe(false);
    });

    it('letting someone in brings them inside and lists them as a guest', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      const req = requests(a).at(-1);
      expect(req?.from).toBe(B);
      town.answerKnock(a.ws, req?.knockId ?? '', true);
      expect(lastState(b)).toMatchObject({ scene: home(A), reason: 'letIn' });
      expect(sent(a, 'town_guests').at(-1)?.data).toEqual({ guests: [B] });
      expect(sent(a, 'town_knock_end')).toHaveLength(1);
    });

    it('declined, away, closed and not-allowed all look the same: no answer after the wait', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      const req = requests(a).at(-1);
      town.answerKnock(a.ws, req?.knockId ?? '', false);
      expect(sent(b, 'town_knock_result')).toHaveLength(0); // not yet
      vi.advanceTimersByTime(30_000);
      expect(sent(b, 'town_knock_result').at(-1)?.data).toEqual({ outcome: 'noAnswer' });
      // A declined knock can't be accepted later.
      town.answerKnock(a.ws, req?.knockId ?? '', true);
      expect(lastState(b)?.scene).toBe(nbhd(A));

      // Not in the inner circle: the owner never hears it.
      const c = fakeWs();
      await enter(c, C, nbhd(A));
      const before = requests(a).length;
      town.knock(c.ws);
      expect(requests(a)).toHaveLength(before);
      vi.advanceTimersByTime(30_000);
      expect(sent(c, 'town_knock_result')).toHaveLength(1);
    });

    it("a closed door never reaches the owner, but doesn't count against them later", async () => {
      const { a, b } = await setup();
      town.setKnocking(a.ws, false);
      town.knock(b.ws);
      expect(requests(a)).toHaveLength(0);
      vi.advanceTimersByTime(30_000);
      town.setKnocking(a.ws, true);
      town.knock(b.ws);
      expect(requests(a)).toHaveLength(1);
    });

    it('after "not now" the owner still hears them knock again, marked as again', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', false);
      vi.advanceTimersByTime(30_000); // that knock runs out: "no answer"
      // Too soon to reach the owner again — and retrying doesn't stretch the wait.
      for (let i = 0; i < 3; i++) {
        town.knock(b.ws);
        vi.advanceTimersByTime(30_000);
      }
      // First knock at 0s; retries at 30s (too soon), 60s (gets through),
      // 90s (too soon again): at most one per minute reaches the owner.
      expect(requests(a)).toHaveLength(2);
      expect(sent(a, 'town_knock_request').at(-1)?.data).toMatchObject({ from: B, again: true });
    });

    it('walking away withdraws the knock', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      await enter(b, B, 'square');
      expect(sent(a, 'town_knock_end')).toHaveLength(1);
      vi.advanceTimersByTime(30_000);
      expect(sent(b, 'town_knock_result')).toHaveLength(0);
    });

    it('asking a guest to leave walks them out, and they wait before knocking again', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      town.kick(a.ws, B);
      expect(lastState(b)).toMatchObject({ scene: nbhd(A), reason: 'visitOver' });
      expect(sent(a, 'town_guests').at(-1)?.data).toEqual({ guests: [] });
      const before = requests(a).length;
      town.knock(b.ws);
      expect(requests(a)).toHaveLength(before);
    });

    it('when the owner steps out, the visit is over for everyone inside', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      await enter(a, A, nbhd(A));
      expect(lastState(b)).toMatchObject({ scene: nbhd(A), reason: 'visitOver' });
    });

    it('a guest who leaves has to knock to come back', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      await enter(b, B, nbhd(A));
      await enter(b, B, home(A));
      expect(sent(b, 'town_denied')).toHaveLength(1);
    });

    it("knocking into a kick's cooldown never shortens it", async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      town.kick(a.ws, B);
      const before = requests(a).length;
      vi.advanceTimersByTime(1_000);
      town.knock(b.ws);
      vi.advanceTimersByTime(92_000);
      town.knock(b.ws);
      expect(requests(a)).toHaveLength(before);
      vi.advanceTimersByTime(10 * 60_000);
      town.knock(b.ws);
      expect(requests(a)).toHaveLength(before + 1);
    });

    it('a knock the owner never heard ends without a word to them', async () => {
      const { a, b } = await setup();
      town.setKnocking(a.ws, false);
      town.knock(b.ws);
      vi.advanceTimersByTime(30_000);
      expect(sent(a, 'town_knock_end')).toHaveLength(0);
      expect(sent(b, 'town_knock_result')).toHaveLength(1);
    });

    it("tells every one of the owner's tabs when the door opens or closes", async () => {
      const { a } = await setup();
      const a2 = fakeWs();
      await enter(a2, A, home(A));
      expect(lastState(a2)).toMatchObject({ knockingOpen: true });
      town.setKnocking(a.ws, false);
      expect(sent(a2, 'town_door').at(-1)?.data).toEqual({ open: false });
    });

    it('updates whether you can knock when the owner edits their inner circle', async () => {
      const c = fakeWs();
      await enter(c, C, nbhd(A));
      expect(lastState(c)?.canKnock).toBe(false);
      inner[A] = [B, C];
      town.communityChanged(A, lists[A] ?? [], inner[A]);
      expect(sent(c, 'town_knock_access').at(-1)?.data).toEqual({ canKnock: true });
    });

    it('a block between knock and "let in" is just no answer, at the usual time', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      const id = requests(a).at(-1)?.knockId ?? '';
      blocks.sync(B, [A]);
      town.answerKnock(a.ws, id, true);
      expect(lastState(b)?.scene).toBe(nbhd(A));
      expect(sent(b, 'town_knock_result')).toHaveLength(0);
      vi.advanceTimersByTime(30_000);
      expect(sent(b, 'town_knock_result')).toHaveLength(1);
    });

    it('a guest who reconnects lands outside the door, not in a stale home', async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      town.leave(b.ws); // the guest's connection drops
      const b2 = fakeWs();
      await enter(b2, B, home(A));
      expect(lastState(b2)).toMatchObject({ scene: nbhd(A), reason: 'visitOver' });
    });

    it("the owner's connection dropping ends the visit too", async () => {
      const { a, b } = await setup();
      town.knock(b.ws);
      town.answerKnock(a.ws, requests(a).at(-1)?.knockId ?? '', true);
      town.leave(a.ws);
      expect(lastState(b)).toMatchObject({ scene: nbhd(A), reason: 'visitOver' });
    });

    it('only the owner, from inside, can answer', async () => {
      const { b } = await setup();
      const c = fakeWs();
      await enter(c, C, nbhd(A));
      town.knock(b.ws);
      town.answerKnock(c.ws, 'k_anything', true);
      town.answerKnock(b.ws, 'k_anything', true);
      expect(lastState(b)?.scene).toBe(nbhd(A));
    });
  });

  describe('asking to join a conversation', () => {
    // In A's neighborhood: A (owner) sees everyone; B and C aren't mutuals.
    let voice: ReturnType<typeof fakeVoice>;
    const settle = () => vi.advanceTimersByTimeAsync(1500);
    const joinRequests = (s: FakeWs) =>
      sent(s, 'town_join_request').map((m) => m.data as { requestId: string; from: string });
    const results = (s: FakeWs) =>
      sent(s, 'town_join_result').map((m) => (m.data as { outcome: string }).outcome);

    async function setup() {
      voice = fakeVoice();
      town.dispose();
      town = new TownRoom(blocks, voice, graph);
      const a = fakeWs();
      const b = fakeWs();
      const c = fakeWs();
      await enter(a, A, nbhd(A), 60, 60);
      await enter(b, B, nbhd(A), 90, 60);
      await settle();
      await enter(c, C, nbhd(A), 60, 100);
      await settle();
      return { a, b, c };
    }

    it("keeps you out of a conversation with someone who isn't your mutual", async () => {
      const { b, c } = await setup();
      expect(lastRoom(b)?.roomId).toBeTruthy();
      expect(lastRoom(c)).toBeUndefined();
    });

    it('asks only the people who would newly see you, and lets you in when they agree', async () => {
      const { a, b, c } = await setup();
      town.askToJoin(c.ws);
      expect(joinRequests(a)).toHaveLength(0); // A already sees C
      const req = joinRequests(b).at(-1);
      expect(req?.from).toBe(C);
      town.answerJoin(b.ws, req?.requestId ?? '', true);
      expect(results(c)).toEqual(['accepted']);
      await settle();
      expect(lastRoom(c)?.roomId).toBe(lastRoom(b)?.roomId);
      expect(seen(b)).toContain(C);
    });

    it('the pass ends when you walk away from the conversation', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      town.answerJoin(b.ws, joinRequests(b).at(-1)?.requestId ?? '', true);
      await settle();
      town.move(c.ws, 1000, 760, 0);
      await settle();
      await settle();
      expect(removed(b)).toContain(C);
      town.move(c.ws, 60, 100, 0);
      await settle();
      expect(lastRoom(c)).toBeNull(); // no pass any more
    });

    it('a "not now" looks like no answer, at the usual time, and you wait to ask again', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      town.answerJoin(b.ws, joinRequests(b).at(-1)?.requestId ?? '', false);
      expect(sent(b, 'town_join_request_end')).toHaveLength(1);
      expect(results(c)).toEqual([]);
      vi.advanceTimersByTime(30_000);
      expect(results(c)).toEqual(['noAnswer']);
      town.askToJoin(c.ws);
      expect(joinRequests(b)).toHaveLength(1); // cooling down: nobody asked
    });

    it('never asks across a block', async () => {
      const { b, c } = await setup();
      blocks.sync(B, [C]);
      town.askToJoin(c.ws);
      expect(joinRequests(b)).toHaveLength(0);
      vi.advanceTimersByTime(30_000);
      expect(results(c)).toEqual(['noAnswer']);
    });

    it('someone who joined the conversation mid-request blocks the pass, and keeps their place', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      const id = joinRequests(b).at(-1)?.requestId ?? '';
      // D (mutual of A and B, not of C) joins the conversation meanwhile.
      lists[D] = [A, B];
      lists[A] = [...(lists[A] ?? []), D];
      lists[B] = [...(lists[B] ?? []), D];
      for (const o of [A, B, D]) town.communityChanged(o, lists[o] ?? [], inner[o] ?? []);
      const d = fakeWs();
      await enter(d, D, nbhd(A), 90, 80);
      await settle();
      const roomBefore = lastRoom(d)?.roomId;
      expect(roomBefore).toBe(lastRoom(b)?.roomId);
      town.answerJoin(b.ws, id, true);
      expect(results(c)).toEqual([]); // not "accepted"
      await settle();
      expect(lastRoom(d)?.roomId).toBe(roomBefore);
      expect(lastRoom(c)).toBeUndefined();
      vi.advanceTimersByTime(30_000);
      expect(results(c)).toEqual(['noAnswer']);
    });

    it('one request at a time', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      town.askToJoin(c.ws);
      expect(joinRequests(b)).toHaveLength(1);
    });

    it('an unused pass lapses on time even if nothing else happens', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      town.answerJoin(b.ws, joinRequests(b).at(-1)?.requestId ?? '', true);
      // Walks off before ever connecting: still in B's view, out of voice range.
      town.move(c.ws, 90, 410, 0);
      await vi.advanceTimersByTimeAsync(300);
      expect(seen(b)).toContain(C); // the pass shows them for now
      await vi.advanceTimersByTimeAsync(11_000);
      expect(removed(b)).toContain(C);
    });

    it('after a "not now", they can ask again once the short wait is over', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      town.answerJoin(b.ws, joinRequests(b).at(-1)?.requestId ?? '', false);
      vi.advanceTimersByTime(30_000);
      town.askToJoin(c.ws); // too soon: nobody asked, and it doesn't stretch the wait
      vi.advanceTimersByTime(30_000);
      expect(joinRequests(b)).toHaveLength(1);
      vi.advanceTimersByTime(3 * 60_000);
      town.askToJoin(c.ws);
      expect(joinRequests(b)).toHaveLength(2);
    });

    it('tells you when asking to join applies, and when it stops', async () => {
      const { c } = await setup();
      expect(sent(c, 'town_join_available').at(-1)?.data).toEqual({ available: true });
      town.move(c.ws, 1000, 760, 0);
      await settle();
      expect(sent(c, 'town_join_available').at(-1)?.data).toEqual({ available: false });
    });

    it('walking away withdraws the request', async () => {
      const { b, c } = await setup();
      town.askToJoin(c.ws);
      await enter(c, C, 'square');
      expect(sent(b, 'town_join_request_end')).toHaveLength(1);
    });
  });

  describe('the lit window', () => {
    const home = (owner: string) => `home:${owner}`;
    const windows = (s: FakeWs) =>
      sent(s, 'town_window').map((m) => (m.data as { lit: boolean }).lit);

    it("glows only for people the owner's own setting already shows them to", async () => {
      town.setVisibility(A, 'inner-circle');
      const a = fakeWs();
      const b = fakeWs(); // inner circle
      const c = fakeWs(); // community only
      await enter(b, B, nbhd(A));
      await enter(c, C, nbhd(A));
      expect(lastState(b)).toMatchObject({ windowLit: false }); // A's not home yet
      await enter(a, A, home(A));
      expect(windows(b)).toEqual([true]);
      expect(windows(c)).toEqual([]);

      // A wider setting (say, re-sent on a reconnect) never lights it for
      // people outside the inner circle while A is home.
      town.setVisibility(A, 'community');
      expect(windows(c)).toEqual([]);
    });

    it('goes dark when the owner goes invisible, steps out or disconnects', async () => {
      town.setVisibility(A, 'inner-circle');
      const a = fakeWs();
      const b = fakeWs();
      await enter(a, A, home(A));
      await enter(b, B, nbhd(A));
      expect(lastState(b)).toMatchObject({ windowLit: true });
      town.setVisibility(A, 'no-one');
      expect(windows(b)).toEqual([false]);
      town.setVisibility(A, 'inner-circle');
      town.leave(a.ws);
      expect(windows(b)).toEqual([false, true, false]);
      // Back home, but A's presence was dropped with their last connection.
      town.forgetVisibility(A);
      await enter(a, A, home(A));
      expect(windows(b)).toEqual([false, true, false]);
    });

    it('stays dark when the owner has never said who may see them', async () => {
      const a = fakeWs();
      const b = fakeWs();
      await enter(a, A, home(A));
      await enter(b, B, nbhd(A));
      expect(lastState(b)).toMatchObject({ windowLit: false });
    });
  });

  it("passes a runner's sprint on to the people who can see them", async () => {
    const a = fakeWs();
    const b = fakeWs();
    await enter(a, A, 'square', 300, 300);
    await enter(b, B, 'square', 320, 300);
    vi.advanceTimersByTime(150);
    town.move(b.ws, 330, 300, 2, true);
    vi.advanceTimersByTime(150);
    const last = sent(a, 'town_view').at(-1)?.data as { upsert: Array<{ sprint?: boolean }> };
    expect(last.upsert[0]?.sprint).toBe(true);
  });

  describe('presence follows where you stand', () => {
    it('caps who sees you online by your most private scene, across tabs', async () => {
      const a1 = fakeWs();
      const a2 = fakeWs();
      expect(town.capVisibility(A, 'everyone')).toBe('everyone'); // not in town
      await enter(a1, A, 'square');
      expect(town.capVisibility(A, 'everyone')).toBe('everyone');
      await enter(a2, A, `home:${A}`);
      // Any tab re-sending "everyone" is still held to the home tab's cap.
      expect(town.capVisibility(A, 'everyone')).toBe('inner-circle');
      expect(town.capVisibility(A, 'no-one')).toBe('no-one'); // never widens
      town.leave(a2.ws);
      town.setFof(a1.ws, true);
      expect(town.capVisibility(A, 'everyone')).toBe('community');
    });

    it("waits for an offline owner's block list before refusing a rejoin", async () => {
      blocks = new BlockService();
      for (const d of [B, C, D]) blocks.sync(d, []); // A (the owner) is offline
      let release: () => void = () => {};
      const loaded = new Promise<void>((r) => {
        release = r;
      });
      let known = false;
      const ownerBlocks = {
        blocks: () => (known ? false : null),
        prefetch: () => {},
        ensure: vi.fn(async () => {
          await loaded;
          known = true;
        }),
      };
      town.dispose();
      town = new TownRoom(blocks, null, graph, ownerBlocks);
      const b = fakeWs();
      const entering = town.enter(b.ws, B, nbhd(A), 300, 300, 0);
      await vi.waitFor(() => {
        expect(ownerBlocks.ensure).toHaveBeenCalledWith(A);
      });
      release();
      await entering;
      expect(lastState(b)?.scene).toBe(nbhd(A)); // not bounced home
    });
  });

  describe('designed spaces', () => {
    const designed = [{ builtin: 'armchair', x: 3, y: 4 }];
    function fakeLayouts() {
      const store = new Map<string, Array<{ builtin: string; x: number; y: number }>>();
      const layouts = {
        get: (owner: string, space: 'home' | 'yard') =>
          store.get(`${owner}|${space}`) ?? TOWN_DEFAULT_LAYOUT[space],
        load: vi.fn(() => Promise.resolve()),
        apply: () => Promise.resolve(),
        refresh: vi.fn((owner: string, space: 'home' | 'yard') => {
          store.set(`${owner}|${space}`, designed);
          layouts.onChange?.(owner, space);
          return Promise.resolve();
        }),
        onChange: undefined as ((owner: string, space: 'home' | 'yard') => void) | undefined,
      };
      return layouts;
    }

    it("sends a space's design with the scene, loading it first", async () => {
      const layouts = fakeLayouts();
      town.dispose();
      town = new TownRoom(blocks, null, graph, undefined, layouts);
      const b = fakeWs();
      await enter(b, B, nbhd(A));
      expect(layouts.load).toHaveBeenCalledWith(A, 'yard');
      expect((lastState(b) as unknown as { layout: unknown }).layout).toEqual(
        TOWN_DEFAULT_LAYOUT.yard,
      );
    });

    it("a saved design is read from the owner's repo and shown to everyone in that space", async () => {
      const layouts = fakeLayouts();
      town.dispose();
      town = new TownRoom(blocks, null, graph, undefined, layouts);
      const a = fakeWs();
      const b = fakeWs();
      const c = fakeWs();
      await enter(a, A, `home:${A}`);
      await enter(b, B, nbhd(A)); // A's yard, not A's home
      await enter(c, C, 'square');
      town.layoutSaved(a.ws, 'home');
      expect(layouts.refresh).toHaveBeenCalledWith(A, 'home');
      expect(sent(a, 'town_layout').at(-1)?.data).toEqual({ space: 'home', placements: designed });
      expect(sent(b, 'town_layout')).toHaveLength(0);
      expect(sent(c, 'town_layout')).toHaveLength(0);
    });
  });
});
