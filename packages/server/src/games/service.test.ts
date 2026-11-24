import { describe, it, expect, vi } from 'vitest';
import type { AtpAgent } from '@atproto/api';
import { findGive, giftItem, giveFields, GIVE_COLLECTION, LEADERBOARD_GIFTS } from './service.js';

const GAME_MASTER = 'did:plc:gamemaster';
const PLAYER = 'did:plc:player';

interface Give {
  uri: string;
  value: Record<string, unknown>;
}

/** An agent over an in-memory give collection, served `pageSize` at a time. */
function fakeAgent(gives: Give[] = [], pageSize = 100) {
  const createRecord = vi.fn((input: { record: Record<string, unknown> }) => {
    gives.push({
      uri: `at://${GAME_MASTER}/${GIVE_COLLECTION}/new${gives.length}`,
      value: input.record,
    });
    return Promise.resolve({ data: {} });
  });
  const listRecords = vi.fn((input: { cursor?: string }) => {
    const start = input.cursor ? Number(input.cursor) : 0;
    const end = start + pageSize;
    return Promise.resolve({
      data: {
        records: gives.slice(start, end),
        cursor: end < gives.length ? String(end) : undefined,
      },
    });
  });
  const agent = {
    did: GAME_MASTER,
    com: { atproto: { repo: { createRecord, listRecords } } },
  } as unknown as AtpAgent;
  return { agent, createRecord, gives };
}

function give(rkey: string, item: string, recipient: string): Give {
  return { uri: `at://${GAME_MASTER}/${GIVE_COLLECTION}/${rkey}`, value: { item, recipient } };
}

const shoes = LEADERBOARD_GIFTS.hurdles;
if (!shoes) throw new Error('hurdles has no leaderboard gift');

describe('leaderboard gifts', () => {
  it('has a gift for each game', () => {
    expect(LEADERBOARD_GIFTS.hopper?.item).toBe('jet_pack');
    expect(shoes.item).toBe('hermes_shoes');
  });

  it('references its images as blobs, so the give keeps them in the repo', () => {
    const fields = giveFields(shoes);
    expect(fields.assetCid).toBe(shoes.asset.cid);
    expect(fields.iconCid).toBe(shoes.icon.cid);
    expect(fields.asset).toEqual({
      $type: 'blob',
      ref: { $link: shoes.asset.cid },
      mimeType: 'image/png',
      size: shoes.asset.size,
    });
    expect(fields.icon).toMatchObject({ $type: 'blob', ref: { $link: shoes.icon.cid } });
  });

  it('writes a give naming the player', async () => {
    const { agent, createRecord } = fakeAgent();

    expect(await giftItem(agent, PLAYER, shoes)).toBe(true);

    expect(createRecord).toHaveBeenCalledExactlyOnceWith({
      repo: GAME_MASTER,
      collection: GIVE_COLLECTION,
      record: expect.objectContaining({
        $type: GIVE_COLLECTION,
        item: 'hermes_shoes',
        recipient: PLAYER,
        iconCid: shoes.icon.cid,
        givenAt: expect.any(String) as string,
      }) as Record<string, unknown>,
    });
  });

  it('gives an item to a player only once', async () => {
    const { agent, createRecord } = fakeAgent();

    expect(await giftItem(agent, PLAYER, shoes)).toBe(true);
    expect(await giftItem(agent, PLAYER, shoes)).toBe(false);

    expect(createRecord).toHaveBeenCalledTimes(1);
  });

  it("is not put off by another player's give, or another item", async () => {
    const { agent } = fakeAgent([
      give('a', 'hermes_shoes', 'did:plc:someone-else'),
      give('b', 'jet_pack', PLAYER),
    ]);

    expect(await giftItem(agent, PLAYER, shoes)).toBe(true);
  });

  it('finds an existing give on a later page', async () => {
    const { agent } = fakeAgent(
      [
        give('a', 'jet_pack', PLAYER),
        give('b', 'jet_pack', 'x'),
        give('c', 'hermes_shoes', PLAYER),
      ],
      1,
    );

    expect(await findGive(agent, PLAYER, 'hermes_shoes')).toMatchObject({ rkey: 'c' });
    expect(await findGive(agent, PLAYER, 'butterfly_net')).toBeNull();
  });
});
