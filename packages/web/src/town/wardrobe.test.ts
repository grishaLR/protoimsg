import { describe, expect, it } from 'vitest';
import { TOWN_BUILTINS } from '@protoimsg/shared';
import { WARDROBE_SPOTS, arrangeWardrobe } from './structures';

const kindOf = (i: number) => WARDROBE_SPOTS[i]?.kind;

describe('arrangeWardrobe', () => {
  it('has a spot for every item a wardrobe can hold', () => {
    expect(WARDROBE_SPOTS).toHaveLength(TOWN_BUILTINS.wardrobe.display);
  });

  it('puts hats on top, clothes on the rail and shoes on the shelf', () => {
    expect(arrangeWardrobe(['headwear', 'tops', 'feet']).map(kindOf)).toEqual([
      'top',
      'hang',
      'shelf',
    ]);
  });

  it('spills over into whatever is free, then runs out of room', () => {
    const spots = arrangeWardrobe(Array.from({ length: 8 }, () => 'headwear'));
    expect(spots.slice(0, 2).map(kindOf)).toEqual(['top', 'top']);
    expect(spots.slice(2, 7).map(kindOf)).toEqual(['hang', 'hang', 'hang', 'shelf', 'shelf']);
    expect(spots[7]).toBe(-1);
    expect(new Set(spots.slice(0, 7)).size).toBe(7);
  });
});
