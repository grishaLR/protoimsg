import { describe, it, expect, vi } from 'vitest';
import { CachedOwnerBlocks } from './town-blocks.js';

const O = 'did:plc:owner';
const V = 'did:plc:visitor';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CachedOwnerBlocks', () => {
  it('is unknown until loaded, then answers from the owner’s list', async () => {
    const blocks = new CachedOwnerBlocks(() => Promise.resolve(new Set([V])));
    const onLoaded = vi.fn();
    blocks.onLoaded = onLoaded;
    expect(blocks.blocks(O, V)).toBeNull();
    blocks.prefetch([O]);
    await flush();
    expect(blocks.blocks(O, V)).toBe(true);
    expect(blocks.blocks(O, 'did:plc:other')).toBe(false);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('stays unknown (closed) when the list cannot be read', async () => {
    const blocks = new CachedOwnerBlocks(() => Promise.reject(new Error('PDS down')));
    blocks.prefetch([O]);
    await flush();
    expect(blocks.blocks(O, V)).toBeNull();
  });

  it('loads each owner once while fresh', async () => {
    const fetchList = vi.fn(() => Promise.resolve(new Set<string>()));
    const blocks = new CachedOwnerBlocks(fetchList);
    blocks.prefetch([O, O]);
    await flush();
    blocks.prefetch([O]);
    await flush();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it('ensure waits for one owner, and gives up after a moment', async () => {
    let finish: (s: Set<string>) => void = () => {};
    const blocks = new CachedOwnerBlocks(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const waiting = blocks.ensure(O);
    finish(new Set([V]));
    await waiting;
    expect(blocks.blocks(O, V)).toBe(true);

    vi.useFakeTimers();
    const never = new CachedOwnerBlocks(() => new Promise(() => {}));
    const gaveUp = never.ensure(O);
    await vi.advanceTimersByTimeAsync(3000);
    await gaveUp;
    expect(never.blocks(O, V)).toBeNull();
    vi.useRealTimers();
  });
});
