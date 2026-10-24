import { describe, expect, it } from 'vitest';
import { TOWN_DEFAULT_LAYOUT } from '@protoimsg/shared';
import { SCENE_MAPS, layoutBlocks, sceneSpace } from './map';

describe('designed spaces on the map', () => {
  it('knows which space each scene is', () => {
    expect(sceneSpace('home')).toBe('home');
    expect(sceneSpace('neighborhood')).toBe('yard');
    expect(sceneSpace('square')).toBeNull();
  });

  it('blocks solid pieces across their footprint, never rugs', () => {
    const blocked = layoutBlocks([
      { builtin: 'bed', x: 1, y: 2 },
      { builtin: 'rug', x: 4, y: 4 },
      { builtin: 'nope', x: 9, y: 9 },
    ]);
    expect(blocked.has('1,2')).toBe(true);
    expect(blocked.has('2,3')).toBe(true); // bed is 2×2
    expect(blocked.has('2,4')).toBe(false);
    expect(blocked.has('3,2')).toBe(false);
    expect(blocked.has('5,5')).toBe(false); // rug: walk over it
    expect(blocked.has('9,9')).toBe(false); // unknown pieces are nothing
  });

  it('leaves the yard and the room open for their layouts', () => {
    // The default yard pines used to be baked into the map.
    for (const p of TOWN_DEFAULT_LAYOUT.yard) {
      expect(SCENE_MAPS.neighborhood.isBlockedTile(p.x, p.y)).toBe(false);
    }
    for (const p of TOWN_DEFAULT_LAYOUT.home) {
      expect(SCENE_MAPS.home.isBlockedTile(p.x, p.y)).toBe(false);
    }
  });
});
