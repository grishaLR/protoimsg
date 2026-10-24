import { describe, it, expect } from 'vitest';
import { TOWN_DEFAULT_LAYOUT, townFootprint, validateTownLayout } from '@protoimsg/shared';

describe('validateTownLayout', () => {
  it('keeps the default home and yard exactly as they are', () => {
    expect(validateTownLayout('home', TOWN_DEFAULT_LAYOUT.home)).toEqual(TOWN_DEFAULT_LAYOUT.home);
    expect(validateTownLayout('yard', TOWN_DEFAULT_LAYOUT.yard)).toEqual(TOWN_DEFAULT_LAYOUT.yard);
  });

  it('drops unknown objects, objects in the wrong space, and junk', () => {
    expect(
      validateTownLayout('home', [
        { builtin: 'dragon', x: 3, y: 3 },
        { builtin: 'pine', x: 3, y: 3 }, // yard only
        { builtin: 'plant', x: 2.5, y: 3 },
        null,
        'couch',
        { builtin: 'plant', x: 3, y: 3 },
      ]),
    ).toEqual([{ builtin: 'plant', x: 3, y: 3 }]);
    expect(validateTownLayout('home', 'not a list')).toEqual([]);
  });

  it('keeps everything on buildable tiles, off the door strip and the yard path', () => {
    // Off the floor (back wall), past the right wall, in front of the door.
    expect(
      validateTownLayout('home', [
        { builtin: 'plant', x: 3, y: 1 },
        { builtin: 'couch', x: 11, y: 5 },
        { builtin: 'plant', x: 6, y: 8 },
      ]),
    ).toEqual([]);
    // On the house, on the path, in the pond.
    expect(
      validateTownLayout('yard', [
        { builtin: 'bush', x: 14, y: 8 },
        { builtin: 'bush', x: 16, y: 15 },
        { builtin: 'bush', x: 24, y: 15 },
      ]),
    ).toEqual([]);
  });

  it("won't stack solid objects, but a rug can sit under furniture", () => {
    expect(
      validateTownLayout('home', [
        { builtin: 'rug', x: 4, y: 4 },
        { builtin: 'armchair', x: 5, y: 5 },
        { builtin: 'plant', x: 5, y: 5 },
      ]),
    ).toEqual([
      { builtin: 'rug', x: 4, y: 4 },
      { builtin: 'armchair', x: 5, y: 5 },
    ]);
  });

  it('skips owned items for now and caps the count', () => {
    expect(
      validateTownLayout('home', [{ item: 'at://did:plc:a/equipment.rpg.item/1', x: 3, y: 3 }]),
    ).toEqual([]);
    const many = Array.from({ length: 300 }, (_, i) => ({
      builtin: 'flowerbed',
      x: 2 + (i % 10) * 2,
      y: 2 + Math.floor(i / 10),
    }));
    expect(validateTownLayout('yard', many).length).toBeLessThanOrEqual(200);
  });

  it('never walls anyone into a corner (every open tile stays reachable)', () => {
    // Two plants around the room's top-left corner tile would seal it off.
    expect(
      validateTownLayout('home', [
        { builtin: 'plant', x: 2, y: 2 },
        { builtin: 'plant', x: 1, y: 3 },
      ]),
    ).toEqual([{ builtin: 'plant', x: 2, y: 2 }]);
    // A rug can't wall anything in: it's walked over.
    expect(validateTownLayout('home', [{ builtin: 'rug', x: 1, y: 2 }])).toHaveLength(1);
  });

  it('turns pieces that turn (swapping their footprint) and ignores turns on the rest', () => {
    // A couch turned upright is 1 wide and 3 tall: it fits a 1-wide gap.
    expect(validateTownLayout('home', [{ builtin: 'couch', x: 6, y: 3, rotation: 1 }])).toEqual([
      { builtin: 'couch', x: 6, y: 3, rotation: 1 },
    ]);
    expect(townFootprint({ builtin: 'couch', rotation: 3 })).toEqual({ w: 1, h: 3 });
    expect(townFootprint({ builtin: 'couch', rotation: 2 })).toEqual({ w: 3, h: 1 });
    // A plant looks the same every way: its turn is dropped.
    expect(validateTownLayout('home', [{ builtin: 'plant', x: 6, y: 3, rotation: 2 }])).toEqual([
      { builtin: 'plant', x: 6, y: 3 },
    ]);
  });

  it('lets you plant right along the path, never on it', () => {
    // The path runs down x 15–16 from the doormat to the gate.
    expect(
      validateTownLayout('yard', [
        { builtin: 'bush', x: 14, y: 15 },
        { builtin: 'bush', x: 17, y: 15 },
        { builtin: 'bush', x: 15, y: 15 },
      ]),
    ).toEqual([
      { builtin: 'bush', x: 14, y: 15 },
      { builtin: 'bush', x: 17, y: 15 },
    ]);
  });
});
