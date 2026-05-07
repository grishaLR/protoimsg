/**
 * Allowlist registry for known ATProto lexicons.
 *
 * Only collections listed here get a tab in `ProfileView`. Anything not in the
 * registry is ignored — no skip lists, no defaults. When a new app shows up
 * worth surfacing, add an entry.
 *
 * Each entry maps one or more collection NSIDs to a tab definition with a
 * render strategy. Multiple collections can fan into one tab (e.g. Standard
 * documents + Pckt documents → "Publications").
 */

export type RenderKind =
  | 'feed'
  | 'publications'
  | 'gallery'
  | 'card'
  | 'audio'
  | 'status'
  | 'arabica'
  | 'teal'
  | 'tangled'
  | 'rpg'
  | 'keytrace';

export interface LexiconTab {
  /** Stable id used as the tab key. */
  id: string;
  /** Display label. */
  label: string;
  /** NSIDs that feed this tab. */
  collections: string[];
  /** How to render each record. */
  render: RenderKind;
}

export const LEXICON_TABS: LexiconTab[] = [
  {
    id: 'status',
    label: 'Status',
    collections: ['io.zzstoatzz.status.record'],
    render: 'status',
  },
  {
    id: 'plyr',
    label: 'Tracks',
    collections: ['fm.plyr.dev.track', 'fm.plyr.track'],
    render: 'audio',
  },
  {
    id: 'publications',
    label: 'Publications',
    collections: [
      'site.standard.document',
      'site.standard.publication',
      'blog.pckt.document',
      'blog.pckt.publication',
    ],
    render: 'publications',
  },
  {
    id: 'photos',
    label: 'Photos',
    collections: ['social.grain.photo'],
    render: 'gallery',
  },
  {
    id: 'popfeed',
    label: 'Popfeed',
    collections: ['social.popfeed.feed.list', 'social.popfeed.feed.review'],
    render: 'card',
  },
  {
    id: 'keytrace',
    label: 'Verified',
    collections: ['dev.keytrace.claim'],
    render: 'keytrace',
  },
  {
    id: 'rpg',
    label: 'Items',
    collections: ['equipment.rpg.item'],
    render: 'rpg',
  },
  {
    id: 'tangled',
    label: 'Repos',
    collections: ['sh.tangled.repo'],
    render: 'tangled',
  },
  {
    id: 'teal',
    label: 'Listens',
    collections: ['fm.teal.alpha.feed.play'],
    render: 'teal',
  },
  {
    id: 'arabica',
    label: 'Coffee',
    collections: [
      'social.arabica.alpha.recipe',
      'social.arabica.alpha.bean',
      'social.arabica.alpha.brewer',
      'social.arabica.alpha.roaster',
      'social.arabica.alpha.grinder',
    ],
    render: 'arabica',
  },
  {
    id: 'feed',
    label: 'Feed',
    collections: ['app.bsky.feed.post'],
    render: 'feed',
  },
];

const TABS_BY_COLLECTION: Map<string, LexiconTab> = new Map(
  LEXICON_TABS.flatMap((tab) => tab.collections.map((c) => [c, tab] as const)),
);

export function tabForCollection(nsid: string): LexiconTab | null {
  return TABS_BY_COLLECTION.get(nsid) ?? null;
}

/**
 * Per-collection URL builders for "open in source app" links. Records get
 * linked to the app that produced them; anything not listed here falls back to
 * pdsls.dev.
 */
const EXTERNAL_URLS: Record<string, (handle: string, rkey: string, uri: string) => string> = {
  'app.bsky.feed.post': (h, r) => `https://bsky.app/profile/${h}/post/${r}`,
  'site.standard.document': (h, r) => `https://standard.site/@${h}/${r}`,
  'site.standard.publication': (h, r) => `https://standard.site/@${h}/${r}`,
  'blog.pckt.document': (h, r) => `https://pckt.blog/@${h}/${r}`,
  'blog.pckt.publication': (h, r) => `https://pckt.blog/@${h}/${r}`,
  'social.grain.photo': (_h, r, uri) => {
    const did = uri.split('/')[2] ?? _h;
    return `https://grain.social/profile/${did}/gallery/${r}`;
  },
  'social.popfeed.feed.list': (_h, _r, uri) =>
    `https://popfeed.social/list/at:/${uri.replace(/^at:\/\//, '')}`,
  'social.popfeed.feed.review': (_h, _r, uri) =>
    `https://popfeed.social/review/at:/${uri.replace(/^at:\/\//, '')}`,
  'fm.plyr.dev.track': (_h, _r, uri) => `https://plyr.fm/at/${uri.replace(/^at:\/\//, '')}`,
  'fm.plyr.track': (_h, _r, uri) => `https://plyr.fm/at/${uri.replace(/^at:\/\//, '')}`,
  'social.arabica.alpha.bean': (h, r) => `https://alpha.arabica.social/beans/${r}?owner=${h}`,
  'social.arabica.alpha.recipe': (h, r) => `https://alpha.arabica.social/recipes/${r}?owner=${h}`,
  'social.arabica.alpha.brewer': (h, r) => `https://alpha.arabica.social/brewers/${r}?owner=${h}`,
  'social.arabica.alpha.roaster': (h, r) => `https://alpha.arabica.social/roasters/${r}?owner=${h}`,
  'social.arabica.alpha.grinder': (h, r) => `https://alpha.arabica.social/grinders/${r}?owner=${h}`,
};

/** Build an "open in app" URL from an at:// record uri + handle, if known. */
export function appUrlFor(uri: string, handle: string): string | null {
  const path = uri.startsWith('at://') ? uri.slice('at://'.length) : uri;
  const [, collection, rkey] = path.split('/');
  if (!collection || !rkey) return null;
  const builder = EXTERNAL_URLS[collection];
  return builder ? builder(handle, rkey, uri) : null;
}
