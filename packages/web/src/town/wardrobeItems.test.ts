import { describe, expect, it, vi } from 'vitest';
import { loadWardrobeItems, picturesOf } from './wardrobeItems';

const OWNER = 'did:plc:owner';
const GM = 'did:plc:gamemaster';
const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';
const uri = (rkey: string, did = OWNER) => `at://${did}/equipment.rpg.item/${rkey}`;

vi.mock('../lib/resolve-pds', () => ({
  resolvePdsForDid: (did: string) => Promise.resolve(`https://pds.test/${did}`),
}));

const records: Record<string, unknown> = {
  hat: { title: 'Hat', category: 'headwear', icon: { $type: 'blob', ref: { $link: CID } } },
  both: {
    title: 'Cape',
    category: 'tops',
    icon: { $type: 'blob', ref: { $link: CID } },
    assetCid: CID,
    provider: GM,
  },
  pack: { title: 'Jet Pack', category: 'hind', assetCid: CID, provider: GM },
  bare: { title: 'No art', category: 'tops' },
};
vi.stubGlobal(
  'fetch',
  vi.fn((url: string) => {
    const rkey = new URL(url).searchParams.get('rkey') ?? '';
    const value = records[rkey];
    return Promise.resolve(
      value
        ? new Response(JSON.stringify({ value }), { status: 200 })
        : new Response('{}', { status: 400 }),
    );
  }),
);

describe('loadWardrobeItems', () => {
  it("reads the owner's own items, in order, with their art", async () => {
    const items = await loadWardrobeItems(
      OWNER,
      [uri('pack'), uri('hat'), uri('bare'), uri('gone'), uri('hat', 'did:plc:someone')].map(
        (item) => ({ item }),
      ),
      new AbortController().signal,
    );
    expect(items.map((i) => i.title)).toEqual(['Jet Pack', 'Hat']);
    // A worn sheet comes from its provider's repo; an icon (no sheet) from the owner's.
    expect(items[1]).toMatchObject({ sheet: false });
    expect(items[1]?.image).toContain(`did=${encodeURIComponent(OWNER)}`);
    expect(items[0]).toMatchObject({ sheet: true, category: 'hind' });
    expect(items[0]?.image).toContain(`did=${encodeURIComponent(GM)}`);
  });

  it('finds an icon in a record read through the API client (a CID object, not $link)', async () => {
    const value = {
      title: 'Hat',
      icon: { $type: 'blob', ref: { toString: () => CID }, mimeType: 'image/png' },
    };
    const pics = await picturesOf(value, OWNER, 'https://pds.test/owner');
    expect(pics.icon?.image).toContain(`cid=${CID}`);
  });

  it("colours the item's own worn layer with its mask and channel colours", async () => {
    const blob = (cid: string) => ({ $type: 'blob', ref: { $link: cid }, mimeType: 'image/png' });
    const pics = await picturesOf(
      {
        title: 'Witchy Hat',
        asset: blob(CID),
        colorway: blob(CID),
        channels: [
          { name: 'main', defaultColor: '#d1781f' },
          { name: 'bad', defaultColor: 'red' },
        ],
        assetCid: CID,
        provider: GM,
      },
      OWNER,
      'https://pds.test/owner',
    );
    // From the owner's own repo, not the provider's; only real colours kept.
    expect(pics.worn?.image).toContain(`did=${encodeURIComponent(OWNER)}`);
    expect(pics.worn?.mask).toContain(`cid=${CID}`);
    expect(pics.worn?.colors).toEqual(['#d1781f']);
  });

  it('shows the icon by default, and the front-facing frame when chosen', async () => {
    const signal = new AbortController().signal;
    const [icon] = await loadWardrobeItems(OWNER, [{ item: uri('both') }], signal);
    expect(icon).toMatchObject({ sheet: false });
    const [worn] = await loadWardrobeItems(OWNER, [{ item: uri('both'), look: 'worn' }], signal);
    expect(worn).toMatchObject({ sheet: true });
  });
});
