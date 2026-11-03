import { describe, it, expect } from 'vitest';
import { TOWN_DEFAULT_LAYOUT, townFootprint, validateTownLayout } from '@protoimsg/shared';

describe('validateTownLayout', () => {
  it('keeps the default home and yard exactly as they are', () => {
    expect(validateTownLayout('home', TOWN_DEFAULT_LAYOUT.home, null)).toEqual(
      TOWN_DEFAULT_LAYOUT.home,
    );
    expect(validateTownLayout('yard', TOWN_DEFAULT_LAYOUT.yard, null)).toEqual(
      TOWN_DEFAULT_LAYOUT.yard,
    );
  });

  it('drops unknown objects, objects in the wrong space, and junk', () => {
    expect(
      validateTownLayout(
        'home',
        [
          { builtin: 'dragon', x: 3, y: 3 },
          { builtin: 'pine', x: 3, y: 3 }, // yard only
          { builtin: 'plant', x: 2.5, y: 3 },
          null,
          'couch',
          { builtin: 'plant', x: 3, y: 3 },
        ],
        null,
      ),
    ).toEqual([{ builtin: 'plant', x: 3, y: 3 }]);
    expect(validateTownLayout('home', 'not a list', null)).toEqual([]);
  });

  it('keeps everything on buildable tiles, off the door strip and the yard path', () => {
    // Off the floor (back wall), past the right wall, in front of the door.
    expect(
      validateTownLayout(
        'home',
        [
          { builtin: 'plant', x: 3, y: 1 },
          { builtin: 'couch', x: 12, y: 5 },
          { builtin: 'plant', x: 6, y: 8 },
        ],
        null,
      ),
    ).toEqual([]);
    // On the house, on the path, in the pond.
    expect(
      validateTownLayout(
        'yard',
        [
          { builtin: 'bush', x: 14, y: 8 },
          { builtin: 'bush', x: 16, y: 15 },
          { builtin: 'bush', x: 24, y: 15 },
        ],
        null,
      ),
    ).toEqual([]);
  });

  it("won't stack solid objects, but a rug can sit under furniture", () => {
    expect(
      validateTownLayout(
        'home',
        [
          { builtin: 'rug', x: 4, y: 4 },
          { builtin: 'armchair', x: 5, y: 5 },
          { builtin: 'plant', x: 5, y: 5 },
        ],
        null,
      ),
    ).toEqual([
      { builtin: 'rug', x: 4, y: 4 },
      { builtin: 'armchair', x: 5, y: 5 },
    ]);
  });

  it('skips owned items for now and caps the count', () => {
    expect(
      validateTownLayout(
        'home',
        [{ item: 'at://did:plc:a/equipment.rpg.item/1', x: 3, y: 3 }],
        null,
      ),
    ).toEqual([]);
    const many = Array.from({ length: 300 }, (_, i) => ({
      builtin: 'flowerbed',
      x: 2 + (i % 10) * 2,
      y: 2 + Math.floor(i / 10),
    }));
    expect(validateTownLayout('yard', many, null).length).toBeLessThanOrEqual(200);
  });

  it('never walls anyone into a corner (every open tile stays reachable)', () => {
    // Two plants around the room's top-left corner tile would seal it off.
    expect(
      validateTownLayout(
        'home',
        [
          { builtin: 'plant', x: 2, y: 2 },
          { builtin: 'plant', x: 1, y: 3 },
        ],
        null,
      ),
    ).toEqual([{ builtin: 'plant', x: 2, y: 2 }]);
    // A rug can't wall anything in: it's walked over.
    expect(validateTownLayout('home', [{ builtin: 'rug', x: 1, y: 2 }], null)).toHaveLength(1);
  });

  it('turns pieces that turn (swapping their footprint) and ignores turns on the rest', () => {
    // A couch turned upright is 1 wide and 2 tall: it fits a 1-wide gap.
    expect(
      validateTownLayout('home', [{ builtin: 'couch', x: 6, y: 3, rotation: 1 }], null),
    ).toEqual([{ builtin: 'couch', x: 6, y: 3, rotation: 1 }]);
    expect(townFootprint({ builtin: 'couch', rotation: 3 })).toEqual({ w: 1, h: 2 });
    expect(townFootprint({ builtin: 'couch', rotation: 2 })).toEqual({ w: 2, h: 1 });
    // A plant looks the same every way: its turn is dropped.
    expect(
      validateTownLayout('home', [{ builtin: 'plant', x: 6, y: 3, rotation: 2 }], null),
    ).toEqual([{ builtin: 'plant', x: 6, y: 3 }]);
  });

  it('lets you plant right along the path, never on it', () => {
    // The path runs down x 15–16 from the doormat to the gate.
    expect(
      validateTownLayout(
        'yard',
        [
          { builtin: 'bush', x: 14, y: 15 },
          { builtin: 'bush', x: 17, y: 15 },
          { builtin: 'bush', x: 15, y: 15 },
        ],
        null,
      ),
    ).toEqual([
      { builtin: 'bush', x: 14, y: 15 },
      { builtin: 'bush', x: 17, y: 15 },
    ]);
  });
});

describe('wardrobe display lists', () => {
  const OWNER = 'did:plc:owner';
  const uri = (did: string, rkey: string) => `at://${did}/equipment.rpg.item/${rkey}`;
  const mine = (rkey: string) => ({ item: uri(OWNER, rkey) });
  const wardrobe = (display: unknown) => ({ builtin: 'wardrobe', x: 3, y: 4, display });

  it("keeps the owner's own items, in order, each once, with their look", () => {
    expect(
      validateTownLayout(
        'home',
        [wardrobe([{ ...mine('b'), look: 'worn' }, mine('a'), mine('b')])],
        OWNER,
      )[0]?.display,
    ).toEqual([{ item: uri(OWNER, 'b'), look: 'worn' }, { item: uri(OWNER, 'a') }]);
  });

  it("shows a look it doesn't know as the icon", () => {
    expect(
      validateTownLayout('home', [wardrobe([{ ...mine('a'), look: 'hologram' }])], OWNER)[0]
        ?.display,
    ).toEqual([mine('a')]);
  });

  it("drops someone else's items, other collections and junk", () => {
    const kept = validateTownLayout(
      'home',
      [
        wardrobe([
          { item: uri('did:plc:someone', 'a') },
          { item: `at://${OWNER}/equipment.rpg.give/a` },
          { item: 'https://example.com/hat.png' },
          uri(OWNER, 'bare-string'),
          42,
          null,
          mine('ok'),
        ]),
      ],
      OWNER,
    );
    expect(kept[0]?.display).toEqual([mine('ok')]);
  });

  it('holds only as many as it has spots', () => {
    const many = Array.from({ length: 12 }, (_, i) => mine(`r${String(i)}`));
    expect(validateTownLayout('home', [wardrobe(many)], OWNER)[0]?.display).toEqual(
      many.slice(0, 7),
    );
  });

  it('shows nothing until items are chosen, and nothing on other pieces', () => {
    expect(validateTownLayout('home', [wardrobe(undefined)], OWNER)[0]).toEqual({
      builtin: 'wardrobe',
      x: 3,
      y: 4,
    });
    expect(
      validateTownLayout(
        'home',
        [{ builtin: 'armchair', x: 3, y: 4, display: [mine('a')] }],
        OWNER,
      )[0],
    ).toEqual({ builtin: 'armchair', x: 3, y: 4 });
  });

  it('keeps no display list when the owner is unknown', () => {
    expect(validateTownLayout('home', [wardrobe([mine('a')])], null)[0]?.display).toBe(undefined);
  });

  it('keeps one wardrobe per home (the first)', () => {
    const kept = validateTownLayout(
      'home',
      [wardrobe([mine('a')]), { builtin: 'wardrobe', x: 6, y: 6, display: [mine('b')] }],
      OWNER,
    );
    expect(kept).toEqual([{ builtin: 'wardrobe', x: 3, y: 4, display: [mine('a')] }]);
  });

  it('is indoors only', () => {
    expect(validateTownLayout('yard', [{ builtin: 'wardrobe', x: 5, y: 5 }], OWNER)).toEqual([]);
  });
});
