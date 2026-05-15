import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { AppBskyFeedDefs, AppBskyEmbedImages } from '@atproto/api';
import { publicAgent } from '../../lib/public-agent';
import { useAuth } from '../../hooks/useAuth';
import { useActorSprite } from '../../hooks/useActorSprite';
import type { SpriteRecord } from '../../hooks/useActorSprite';
import { RunnerGame } from '../games/RunnerGame';
import { useGermDeclaration } from '../../hooks/useGermDeclaration';
import { useActorCollections, useActorRecords } from '../../hooks/useActorRecords';
import {
  LEXICON_TABS,
  tabForCollection,
  appUrlFor,
  type LexiconTab,
  type RenderKind,
} from '../../lib/lexicon-registry';
import { collectImageBlobs, collectAudioBlobs, blobUrl, pdslsUrl } from '../../lib/record-blobs';
import { resolvePdsForDid } from '../../lib/resolve-pds';
import { isSafeUrl } from '../../lib/sanitize';
import { API_URL } from '../../lib/config';
import styles from './ProfileView.module.css';

interface StatusRecord {
  emoji: string;
  text?: string;
  expires?: string;
  createdAt: string;
}

function StatusBadge({ pds, did }: { pds: string; did: string }) {
  const { data: status } = useQuery({
    queryKey: ['actorStatus', did],
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<(StatusRecord & { rkey: string }) | null> => {
      const params = new URLSearchParams({
        repo: did,
        collection: 'io.zzstoatzz.status.record',
        limit: '10',
      });
      const res = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { records: Array<{ uri: string; value: unknown }> };
      const now = Date.now();
      const active = json.records
        .map((r) => {
          const parts = r.uri.split('/');
          const rkey = parts[parts.length - 1] ?? '';
          return { ...(r.value as StatusRecord), rkey };
        })
        .filter((r) => r.emoji && r.rkey && (!r.expires || new Date(r.expires).getTime() > now))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return active[0] ?? null;
    },
  });

  if (!status) return null;

  const isCustom = status.emoji.startsWith('custom:');
  const emojiName = isCustom ? status.emoji.slice('custom:'.length) : null;
  const statusUrl = `https://status.zzstoatzz.io/status/${did}/${status.rkey}`;

  return (
    <div className={styles.statusBadge}>
      {emojiName ? (
        <img
          className={styles.statusEmoji}
          src={`https://all-the.bufo.zone/${emojiName}.png`}
          alt={emojiName}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith('.gif')) img.src = `https://all-the.bufo.zone/${emojiName}.gif`;
          }}
        />
      ) : (
        <span className={styles.statusEmojiText}>{status.emoji}</span>
      )}
      {status.text && (
        // eslint-disable-next-line no-restricted-syntax -- https base URL + DID + rkey; no user input
        <a href={statusUrl} className={styles.statusText} target="_blank" rel="noopener noreferrer">
          {status.text}
        </a>
      )}
      {emojiName && (
        <a
          className={styles.statusCredit}
          href="https://status.zzstoatzz.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by status.zzstoatzz.io
        </a>
      )}
    </div>
  );
}

const GAME_SEQ = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
];

function SpriteWalker({
  pds,
  did,
  statusText,
  viewerDid,
  viewerPds,
  cursorDir,
}: {
  pds: string;
  did: string;
  statusText?: string;
  viewerDid?: string | null;
  viewerPds?: string | null;
  cursorDir: 'left' | 'right' | 'up' | 'down' | null;
}) {
  const { data: sprite } = useActorSprite(did, pds);
  const { data: viewerSprite } = useActorSprite(viewerDid ?? undefined, viewerPds ?? undefined);

  if (!sprite?.spriteSheet.ref.$link) return null;

  const { frameWidth: fw, frameHeight: fh } = sprite;
  const scale = 2;
  const rfw = fw * scale;
  const rfh = fh * scale;
  const hasViewer = !!viewerSprite && !!viewerDid && viewerDid !== did;

  const makeSpriteStyle = (sp: SpriteRecord, spPds: string, spDid: string) =>
    ({
      width: rfw,
      height: rfh,
      backgroundImage: `url(${blobUrl(spPds, spDid, sp.spriteSheet.ref.$link)})`,
      backgroundSize: `${sp.width * scale}px ${sp.height * scale}px`,
      '--sprite-total-w': `-${sp.columns * rfw}px`,
      '--row-down': '0px',
      '--row-left': `-${rfh}px`,
      '--row-right': `-${2 * rfh}px`,
      '--row-up': `-${3 * rfh}px`,
    }) as React.CSSProperties;

  const dirClass =
    cursorDir === 'right'
      ? styles.spriteFaceRight
      : cursorDir === 'left'
        ? styles.spriteFaceLeft
        : cursorDir === 'up'
          ? styles.spriteFaceUp
          : cursorDir === 'down'
            ? styles.spriteFaceDown
            : '';

  return (
    <>
      <div
        className={`${styles.spriteTrack} ${cursorDir ? styles.spriteTrackPaused : ''}`}
        style={{ '--sprite-h': `${rfh}px` } as React.CSSProperties}
      >
        <div
          className={[styles.sprite, hasViewer ? styles.spriteOwner : '', dirClass]
            .filter(Boolean)
            .join(' ')}
          style={makeSpriteStyle(sprite, pds, did)}
        />
        {viewerSprite && viewerDid && viewerDid !== did && viewerPds && (
          <div
            className={[styles.sprite, styles.spriteVisitor, dirClass].filter(Boolean).join(' ')}
            style={makeSpriteStyle(viewerSprite, viewerPds, viewerDid)}
          />
        )}
      </div>
      {statusText && (
        <div
          className={styles.spriteBubble}
          style={{ '--bubble-bottom': `${rfh + 8}px` } as React.CSSProperties}
          aria-hidden="true"
        >
          {statusText.length > 58 ? `${statusText.slice(0, 55)}…` : statusText}
        </div>
      )}
    </>
  );
}

function SpriteHead({ pds, did, size = 56 }: { pds: string; did: string; size?: number }) {
  const { data: sprite } = useActorSprite(did, pds);
  if (!sprite?.spriteSheet.ref.$link) return null;

  const { frameWidth: fw, frameHeight: fh, width, height } = sprite;
  // Show the top 50% of frame 0 row 0 (front-facing idle = head area)
  const headH = Math.ceil(fh * 0.5);
  const scale = size / fw;
  return (
    <div
      style={{
        width: size,
        height: Math.round(headH * scale),
        backgroundImage: `url(${blobUrl(pds, did, sprite.spriteSheet.ref.$link)})`,
        backgroundSize: `${width * scale}px ${height * scale}px`,
        backgroundPosition: '0 0',
        backgroundRepeat: 'no-repeat',
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

interface ProfileViewProps {
  actor: string;
  onBack: () => void;
}

interface TabSpec {
  id: string;
  label: string;
  collections: string[];
  render: RenderKind;
}

const SCROLL_BOTTOM_THRESHOLD = 200;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 60_000) return 'now';
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / (60 * 60_000))}h`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;
  return d.toLocaleDateString();
}

const TITLE_FIELDS = ['title', 'name', 'displayName', 'subject'];
const BODY_FIELDS = [
  'text',
  'description',
  'notes',
  'content',
  'body',
  'message',
  'summary',
  'caption',
];

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

interface RecordItem {
  uri: string;
  cid: string;
  value: unknown;
}

interface RenderContext {
  pds: string;
  did: string;
  handle: string;
}

function linkForRecord(uri: string, handle: string): string {
  return appUrlFor(uri, handle) ?? pdslsUrl(uri);
}

function PostCard({ item }: { item: AppBskyFeedDefs.FeedViewPost }) {
  const post = item.post;
  const record = post.record as { text?: string; createdAt?: string };
  const text = record.text ?? '';
  const createdAt = record.createdAt;

  const embed = post.embed as
    | (AppBskyEmbedImages.View & { $type: 'app.bsky.embed.images#view' })
    | { $type: string }
    | undefined;
  const images =
    embed && embed.$type === 'app.bsky.embed.images#view'
      ? (embed as AppBskyEmbedImages.View).images
      : null;

  return (
    <article className={styles.post}>
      {text && <div className={styles.postText}>{text}</div>}
      {images && images.length > 0 && (
        <div className={styles.postImages}>
          {images.map((img, i) =>
            isSafeUrl(img.thumb) ? (
              <img
                key={i}
                className={styles.postImage}
                // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
                src={img.thumb}
                alt={img.alt}
              />
            ) : null,
          )}
        </div>
      )}
      {createdAt && <div className={styles.postMeta}>{formatDate(createdAt)}</div>}
    </article>
  );
}

/** Default card: image + headline + body + link-out to pdsls.dev. */
function DefaultCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const title = obj ? pickString(obj, TITLE_FIELDS) : null;
  const body = obj ? pickString(obj, BODY_FIELDS) : null;
  const createdAt = obj && typeof obj.createdAt === 'string' ? obj.createdAt : null;

  const blobs = collectImageBlobs(record.value);
  const heroBlob = blobs[0] ?? null;

  return (
    <article className={styles.post}>
      {heroBlob && (
        <img
          className={styles.cardHero}
          src={blobUrl(ctx.pds, ctx.did, heroBlob.cid)}
          alt=""
          loading="lazy"
        />
      )}
      {title && <div className={styles.recordTitle}>{title}</div>}
      {body && <div className={styles.postText}>{body}</div>}
      {!title && !body && !heroBlob && (
        <pre className={styles.recordJson}>{JSON.stringify(record.value, null, 2)}</pre>
      )}
      <div className={styles.cardFooter}>
        <span className={styles.postMeta}>
          {createdAt ? formatDate(createdAt) : record.uri.split('/').pop()}
        </span>
        <a
          className={styles.recordLink}
          href={linkForRecord(record.uri, ctx.handle)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

interface PopfeedItem {
  uri: string;
  title: string;
  posterUrl: string | null;
  mainCredit: string | null;
  mainCreditRole: string | null;
  genres: string[];
  creativeWorkType: string | null;
  addedAt: string | null;
  listUri: string | null;
}

function parseListItem(r: { uri: string; value: unknown }): PopfeedItem | null {
  const obj = r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
  if (!obj) return null;
  return {
    uri: r.uri,
    title: typeof obj.title === 'string' ? obj.title : (r.uri.split('/').pop() ?? ''),
    posterUrl: typeof obj.posterUrl === 'string' ? obj.posterUrl : null,
    mainCredit: typeof obj.mainCredit === 'string' ? obj.mainCredit : null,
    mainCreditRole: typeof obj.mainCreditRole === 'string' ? obj.mainCreditRole : null,
    genres: Array.isArray(obj.genres)
      ? (obj.genres as unknown[]).filter((g): g is string => typeof g === 'string')
      : [],
    creativeWorkType: typeof obj.creativeWorkType === 'string' ? obj.creativeWorkType : null,
    addedAt: typeof obj.addedAt === 'string' ? obj.addedAt : null,
    listUri: typeof obj.listUri === 'string' ? obj.listUri : null,
  };
}

function PopfeedListCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const name = typeof obj?.name === 'string' ? obj.name : null;
  const createdAt = typeof obj?.createdAt === 'string' ? obj.createdAt : null;

  const { data: items = [] } = useQuery<PopfeedItem[]>({
    queryKey: ['popfeedListItems', ctx.pds, ctx.did, record.uri],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const results: PopfeedItem[] = [];
      let cursor: string | undefined;
      // fetch up to 100 listItems, filter to this list
      do {
        const params = new URLSearchParams({
          repo: ctx.did,
          collection: 'social.popfeed.feed.listItem',
          limit: '100',
        });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.listRecords?${params}`);
        if (!res.ok) break;
        const json = (await res.json()) as {
          records: Array<{ uri: string; value: unknown }>;
          cursor?: string;
        };
        for (const r of json.records) {
          const item = parseListItem(r);
          if (item?.listUri === record.uri) results.push(item);
        }
        cursor = json.cursor;
      } while (cursor && results.length < 50);
      return results;
    },
  });

  return (
    <article className={styles.post}>
      <div className={styles.cardFooter} style={{ marginBottom: 'var(--cm-space-2)' }}>
        {name && <div className={styles.recordTitle}>{name}</div>}
        <a
          className={styles.recordLink}
          href={linkForRecord(record.uri, ctx.handle)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View list <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
      {items.length > 0 && (
        <div className={styles.popfeedItemGrid}>
          {items.map((item) => (
            <div key={item.uri} className={styles.popfeedGridItem} title={item.title}>
              {item.posterUrl ? (
                <img
                  src={item.posterUrl}
                  alt={item.title}
                  loading="lazy"
                  className={styles.popfeedGridPoster}
                />
              ) : (
                <div className={styles.popfeedGridPoster} />
              )}
              <div className={styles.popfeedGridTitle}>{item.title}</div>
              {item.mainCredit && <div className={styles.popfeedGridCredit}>{item.mainCredit}</div>}
            </div>
          ))}
        </div>
      )}
      <span className={styles.postMeta}>{createdAt ? formatDate(createdAt) : null}</span>
    </article>
  );
}

function PopfeedItemCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const item = parseListItem({ uri: record.uri, value: record.value });
  if (!item) return null;
  return (
    <article className={styles.post}>
      {item.posterUrl && (
        <img
          className={styles.popfeedPoster}
          src={item.posterUrl}
          alt={item.title}
          loading="lazy"
        />
      )}
      <div className={styles.popfeedReviewMeta}>
        {item.creativeWorkType && (
          <span className={styles.popfeedTypeBadge}>
            {item.creativeWorkType.replace(/_/g, ' ')}
          </span>
        )}
        {item.mainCredit && (
          <span className={styles.popfeedTypeBadge}>
            {item.mainCreditRole ? `${item.mainCreditRole}: ` : ''}
            {item.mainCredit}
          </span>
        )}
      </div>
      <div className={styles.recordTitle}>{item.title}</div>
      {item.genres.length > 0 && (
        <div className={styles.popfeedGenres}>
          {item.genres.map((g) => (
            <span key={g} className={styles.popfeedGenreTag}>
              {g}
            </span>
          ))}
        </div>
      )}
      <div className={styles.cardFooter}>
        <span className={styles.postMeta}>{item.addedAt ? formatDate(item.addedAt) : null}</span>
        <a
          className={styles.recordLink}
          href={linkForRecord(record.uri, ctx.handle)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function PopfeedReviewCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const title = typeof obj?.title === 'string' ? obj.title : null;
  const text = typeof obj?.text === 'string' ? obj.text : null;
  const posterUrl = typeof obj?.posterUrl === 'string' ? obj.posterUrl : null;
  const backdropUrl = typeof obj?.backdropUrl === 'string' ? obj.backdropUrl : null;
  const rating = typeof obj?.rating === 'number' ? obj.rating : null;
  const genres = Array.isArray(obj?.genres)
    ? (obj.genres as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  const creativeWorkType = typeof obj?.creativeWorkType === 'string' ? obj.creativeWorkType : null;
  const createdAt = typeof obj?.createdAt === 'string' ? obj.createdAt : null;
  const isRevisit = obj?.isRevisit === true;
  const imgSrc = posterUrl ?? backdropUrl ?? null;

  return (
    <article className={styles.post}>
      {imgSrc && (
        <img className={styles.popfeedPoster} src={imgSrc} alt={title ?? ''} loading="lazy" />
      )}
      <div className={styles.popfeedReviewMeta}>
        {creativeWorkType && (
          <span className={styles.popfeedTypeBadge}>{creativeWorkType.replace(/_/g, ' ')}</span>
        )}
        {isRevisit && <span className={styles.popfeedTypeBadge}>revisit</span>}
        {rating !== null && (
          <span className={styles.popfeedRating}>
            {'★'.repeat(Math.round(rating / 2))}
            {'☆'.repeat(5 - Math.round(rating / 2))} {rating}/10
          </span>
        )}
      </div>
      {title && <div className={styles.recordTitle}>{title}</div>}
      {genres.length > 0 && (
        <div className={styles.popfeedGenres}>
          {genres.map((g) => (
            <span key={g} className={styles.popfeedGenreTag}>
              {g}
            </span>
          ))}
        </div>
      )}
      {text && <div className={styles.postText}>{text}</div>}
      <div className={styles.cardFooter}>
        <span className={styles.postMeta}>{createdAt ? formatDate(createdAt) : null}</span>
        <a
          className={styles.recordLink}
          href={linkForRecord(record.uri, ctx.handle)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

/** Publication card: bigger title, smaller body excerpt, link-out. */
function PublicationCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;

  // blog.pckt.document wraps a site.standard.document via document.uri — follow the ref
  const isPcktDoc = obj !== null && obj.$type === 'blog.pckt.document';
  const pcktDocRef =
    isPcktDoc && typeof obj.document === 'object' && obj.document !== null
      ? (((obj.document as Record<string, unknown>).uri as string | undefined) ?? null)
      : null;

  const { data: resolvedDoc } = useQuery<Record<string, unknown> | null>({
    queryKey: ['pcktDocResolve', ctx.pds, pcktDocRef],
    enabled: !!pcktDocRef,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      if (!pcktDocRef) return null;
      const atPath = pcktDocRef.slice('at://'.length);
      const [did, collection, rkey] = atPath.split('/');
      if (!did || !collection || !rkey) return null;
      const params = new URLSearchParams({ repo: did, collection, rkey });
      const res = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.getRecord?${params}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { value?: Record<string, unknown> };
      return json.value ?? null;
    },
  });

  // For pckt docs: use fields from the resolved site.standard.document
  const effectiveObj = isPcktDoc && resolvedDoc ? resolvedDoc : obj;

  const title = effectiveObj ? pickString(effectiveObj, TITLE_FIELDS) : null;
  const body = effectiveObj ? pickString(effectiveObj, BODY_FIELDS) : null;
  const publishedAt =
    typeof effectiveObj?.publishedAt === 'string' ? effectiveObj.publishedAt : null;
  const createdAt = typeof effectiveObj?.createdAt === 'string' ? effectiveObj.createdAt : null;
  const blobs = collectImageBlobs(record.value);
  const heroBlob = blobs[0] ?? null;

  // publication records → site URL; document records → site+path
  // "site" can be an https:// URL or an at:// URI that must be resolved to get its "url" field
  const urlField = typeof effectiveObj?.url === 'string' ? effectiveObj.url : null;
  // For pckt docs: use the resolved standard doc's site + path (points to site.standard.publication which has a url field)
  const siteRaw = typeof effectiveObj?.site === 'string' ? effectiveObj.site : null;
  const path = typeof effectiveObj?.path === 'string' ? effectiveObj.path : null;
  const siteIsAtUri = siteRaw?.startsWith('at://') ?? false;

  const { data: resolvedSite } = useQuery<string | null>({
    queryKey: ['stdSiteResolve', ctx.pds, siteRaw],
    enabled: siteIsAtUri && !!siteRaw,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      // siteRaw = at://did/collection/rkey → fetch that record, read its "url" field
      if (!siteRaw) return null;
      const atPath = siteRaw.slice('at://'.length);
      const [did, collection, rkey] = atPath.split('/');
      if (!did || !collection || !rkey) return null;
      const params = new URLSearchParams({ repo: did, collection, rkey });
      const res = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.getRecord?${params}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { value?: Record<string, unknown> };
      // site.standard.publication has a "url" field; blog.pckt.publication chains further
      // via publication.uri → site.standard.publication — handle one more hop if needed
      if (typeof json.value?.url === 'string') return json.value.url;
      const pubUri =
        json.value?.publication && typeof json.value.publication === 'object'
          ? (((json.value.publication as Record<string, unknown>).uri as string | undefined) ??
            null)
          : null;
      if (!pubUri) return null;
      const pubPath = pubUri.slice('at://'.length);
      const [pdid, pcol, prkey] = pubPath.split('/');
      if (!pdid || !pcol || !prkey) return null;
      const pubParams = new URLSearchParams({ repo: pdid, collection: pcol, rkey: prkey });
      const pubRes = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.getRecord?${pubParams}`);
      if (!pubRes.ok) return null;
      const pubJson = (await pubRes.json()) as { value?: Record<string, unknown> };
      return typeof pubJson.value?.url === 'string' ? pubJson.value.url : null;
    },
  });

  const site = siteIsAtUri ? (resolvedSite ?? null) : siteRaw;
  const sitePathUrl =
    site && path ? `${site.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}` : null;
  const href =
    [urlField, sitePathUrl, linkForRecord(record.uri, ctx.handle)].find(
      (u): u is string => typeof u === 'string' && isSafeUrl(u),
    ) ?? pdslsUrl(record.uri);

  const [unfurled, setUnfurled] = useState(false);

  // Extract leaflet content blocks for inline rendering
  const contentBlocks: Array<{ type: string; text?: string; blobCid?: string }> = useMemo(() => {
    const content =
      obj?.content && typeof obj.content === 'object'
        ? (obj.content as Record<string, unknown>)
        : null;
    const pages = Array.isArray(content?.pages) ? (content.pages as unknown[]) : [];
    const blocks: Array<{ type: string; text?: string; blobCid?: string }> = [];
    for (const page of pages) {
      const p = page && typeof page === 'object' ? (page as Record<string, unknown>) : null;
      const pageBlocks = Array.isArray(p?.blocks) ? (p.blocks as unknown[]) : [];
      for (const b of pageBlocks) {
        const entry = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
        const block =
          entry?.block && typeof entry.block === 'object'
            ? (entry.block as Record<string, unknown>)
            : null;
        if (!block) continue;
        const btype = typeof block.$type === 'string' ? block.$type : '';
        if (btype.includes('text') && typeof block.plaintext === 'string') {
          blocks.push({ type: 'text', text: block.plaintext });
        } else if (btype.includes('image')) {
          const img =
            block.image && typeof block.image === 'object'
              ? (block.image as Record<string, unknown>)
              : null;
          const ref =
            img?.ref && typeof img.ref === 'object' ? (img.ref as Record<string, unknown>) : null;
          const cid = typeof ref?.$link === 'string' ? ref.$link : null;
          if (cid) blocks.push({ type: 'image', blobCid: cid });
        }
      }
    }
    return blocks;
  }, [obj]);

  const hasContent = contentBlocks.length > 0;

  return (
    <article className={styles.publication}>
      {heroBlob && (
        <img
          className={styles.publicationHero}
          src={blobUrl(ctx.pds, ctx.did, heroBlob.cid)}
          alt=""
          loading="lazy"
        />
      )}
      <div className={styles.publicationBody}>
        {title && <div className={styles.publicationTitle}>{title}</div>}
        {!unfurled && body && <div className={styles.publicationExcerpt}>{body}</div>}
        <div className={styles.cardFooter}>
          <span className={styles.postMeta}>{formatDate(publishedAt ?? createdAt ?? '')}</span>
          <div className={styles.publicationActions}>
            {hasContent && (
              <button
                className={styles.unfurlBtn}
                onClick={() => {
                  setUnfurled((v) => !v);
                }}
                type="button"
              >
                {unfurled ? 'Collapse' : 'Unfurl'}
              </button>
            )}
            <a className={styles.recordLink} href={href} target="_blank" rel="noopener noreferrer">
              Read <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
      {unfurled && (
        <div className={styles.publicationUnfurled}>
          <div className={styles.publicationContent}>
            {contentBlocks.map((block, i) =>
              block.type === 'text' ? (
                <p key={i} className={styles.publicationParagraph}>
                  {block.text}
                </p>
              ) : block.type === 'image' && block.blobCid ? (
                <img
                  key={i}
                  className={styles.publicationContentImg}
                  src={blobUrl(ctx.pds, ctx.did, block.blobCid)}
                  alt=""
                  loading="lazy"
                />
              ) : null,
            )}
          </div>
        </div>
      )}
    </article>
  );
}

const WAVE_EXTRA_COLORS = ['#bf5fff', '#ffe44d', '#00cfff', '#ff6ec7', '#ff4040', '#00ff9f'];
interface WaveLine {
  id: number;
  color: string;
  phase: number;
  speed: number;
  ampMod: number;
}
interface WaveSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function WinampPlayer({
  src,
  coverSrc,
  title,
  artist,
  linkHref,
}: {
  src: string;
  coverSrc: string | null;
  title: string;
  artist: string | null;
  linkHref: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const peakHoldsRef = useRef<number[]>(Array<number>(16).fill(0));
  const barLevelsRef = useRef<number[]>(Array<number>(16).fill(0)); // smoothed bar values
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const linesRef = useRef<WaveLine[]>([{ id: 0, color: '#39ff14', phase: 0, speed: 1, ampMod: 1 }]);
  const sparksRef = useRef<WaveSpark[]>([]);
  const lineIdRef = useRef(1);
  const avgEnergyRef = useRef(0.05);
  const lastSpawnRef = useRef(0);
  const peakTimesRef = useRef<number[]>([]);
  const tempoRef = useRef(400);
  const nextFallbackSpawnRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const proxySrc = useMemo(() => {
    try {
      const u = new URL(src);
      if (u.origin === window.location.origin) return src;
      return `${API_URL}/api/audio-proxy?url=${encodeURIComponent(src)}`;
    } catch {
      return src;
    }
  }, [src]);

  const initAudio = useCallback(async () => {
    if (!audioRef.current || sourceRef.current) return;
    const actx = new AudioContext();
    const analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    const source = actx.createMediaElementSource(audioRef.current);
    source.connect(analyser);
    analyser.connect(actx.destination);
    audioCtxRef.current = actx;
    analyserRef.current = analyser;
    sourceRef.current = source;
    if (actx.state === 'suspended') await actx.resume();
  }, []);

  const spawnLine = useCallback((canvas: HTMLCanvasElement) => {
    const { width: w, height: h } = canvas;
    const color = WAVE_EXTRA_COLORS[lineIdRef.current % WAVE_EXTRA_COLORS.length] ?? '#39ff14';
    linesRef.current.push({
      id: lineIdRef.current++,
      color,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.8,
      ampMod: 0.4 + Math.random() * 0.5,
    });
    if (linesRef.current.length > 6) linesRef.current.shift();
    // sparks
    const count = 16 + Math.floor(Math.random() * 10);
    const x0 = w * 0.2 + Math.random() * w * 0.6;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 3;
      sparksRef.current.push({
        x: x0 + (Math.random() - 0.5) * 30,
        y: h / 2 + (Math.random() - 0.5) * h * 0.4,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        life: 1,
      });
    }
  }, []);

  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const { width: w, height: h } = canvas;
    const now = performance.now();
    const t = now / tempoRef.current;
    const clamp = (v: number) => Math.max(2, Math.min(h - 2, v));

    // CRT dot-grid background
    ctx2d.fillStyle = '#060809';
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = '#0d2010';
    for (let gx = 0; gx < w; gx += 4) {
      for (let gy = 0; gy < h; gy += 4) {
        ctx2d.fillRect(gx, gy, 1, 1);
      }
    }

    // ── beat detection (real analyser) ────────────────────────────
    const analyser = analyserRef.current;
    if (analyser) {
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + (v - 128) ** 2, 0) / buf.length) / 128;
      avgEnergyRef.current = avgEnergyRef.current * 0.92 + rms * 0.08;
      const avg = avgEnergyRef.current;

      // tempo: track peaks, estimate interval
      if (rms > avg * 1.8 && rms > 0.08) {
        const peaks = peakTimesRef.current;
        peaks.push(now);
        if (peaks.length > 12) peaks.shift();
        if (peaks.length >= 2) {
          const intervals = peaks.slice(1).map((p, i) => p - (peaks[i] ?? 0));
          const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
          tempoRef.current += (avgInterval / 6 - tempoRef.current) * 0.15;
        }
        // spawn new line on big spike with cooldown
        if (rms > avg * 2.8 && now - lastSpawnRef.current > 1800) {
          lastSpawnRef.current = now;
          spawnLine(canvas);
        }
      }

      // normalize so lines always fill visible space regardless of volume
      const maxDev = Math.max(...Array.from(buf).map((v) => Math.abs(v - 128))) / 128;
      const normScale = Math.max(maxDev, 0.08); // floor so silence still has a tiny line

      const step = w / buf.length;
      const numLines = linesRef.current.length;
      linesRef.current.forEach((line, li) => {
        // stagger sample offset so each line traces a visually distinct shape
        const sampleShift = Math.floor((li / Math.max(numLines, 1)) * buf.length * 0.15);
        // spread centers evenly across 20%–80% of canvas height
        const yCenter = numLines === 1 ? h / 2 : h * (0.2 + (li / (numLines - 1)) * 0.6);
        ctx2d.beginPath();
        ctx2d.strokeStyle = line.color;
        ctx2d.shadowColor = line.color;
        ctx2d.shadowBlur = 6;
        ctx2d.lineWidth = li === 0 ? 2 : 1.5;
        buf.forEach((_val, i) => {
          const val = buf[(i + sampleShift) % buf.length] ?? 128;
          const dev = (val - 128) / 128 / normScale; // normalized −1…1
          const wobble = Math.sin(i / 20 + t * line.speed + line.phase) * 2;
          const laneH = numLines === 1 ? h * 0.85 : (h * 0.7) / numLines;
          const y = clamp(yCenter + dev * laneH * 0.5 * line.ampMod + wobble);
          if (i === 0) ctx2d.moveTo(0, y);
          else ctx2d.lineTo(i * step, y);
        });
        ctx2d.stroke();
      });
    } else {
      // ── fallback: animated sine, spawn on timer ────────────────
      if (now > nextFallbackSpawnRef.current && linesRef.current.length < 6) {
        nextFallbackSpawnRef.current = now + 4000 + Math.random() * 4000;
        spawnLine(canvas);
      }
      for (const line of linesRef.current) {
        ctx2d.beginPath();
        ctx2d.strokeStyle = line.color;
        ctx2d.shadowColor = line.color;
        ctx2d.shadowBlur = 5;
        ctx2d.lineWidth = line.id === 0 ? 2 : 1.5;
        for (let i = 0; i <= w; i++) {
          const y = clamp(
            h / 2 +
              Math.sin(i / 25 + t * line.speed + line.phase) * (h / 3) * line.ampMod +
              Math.sin(i / 60 + t * 0.5 * line.speed) * (h / 5) * line.ampMod +
              Math.sin(i / 10 + t * 1.3 * line.speed + line.phase) * (h / 10),
          );
          if (i === 0) ctx2d.moveTo(0, y);
          else ctx2d.lineTo(i, y);
        }
        ctx2d.stroke();
      }
    }

    // ── sparks ────────────────────────────────────────────────────
    ctx2d.shadowBlur = 0;
    sparksRef.current = sparksRef.current.filter((s) => s.life > 0);
    for (const s of sparksRef.current) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08; // gravity
      s.life -= 0.03;
      ctx2d.beginPath();
      ctx2d.globalAlpha = Math.max(0, s.life);
      ctx2d.fillStyle = s.color;
      ctx2d.arc(s.x, s.y, 2, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;

    // ── spectrum bars ─────────────────────────────────────────────
    const specCanvas = specCanvasRef.current;
    if (specCanvas) {
      const sc = specCanvas.getContext('2d');
      if (sc) {
        const sw = specCanvas.width;
        const sh = specCanvas.height;
        const N = 16;
        const gap = 1;
        const barW = Math.floor((sw - gap * (N - 1)) / N);
        // CRT dot-grid background
        sc.fillStyle = '#060809';
        sc.fillRect(0, 0, sw, sh);
        sc.fillStyle = '#0d2010';
        for (let gx = 0; gx < sw; gx += 4) {
          for (let gy = 0; gy < sh; gy += 4) {
            sc.fillRect(gx, gy, 1, 1);
          }
        }

        const levels: number[] = [];
        if (analyser) {
          const freqBuf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(freqBuf);
          // log-scale bin edges: more resolution in bass where energy lives
          const maxBin = Math.floor(freqBuf.length * 0.6); // ignore top 40% (ultrasonic)
          for (let b = 0; b < N; b++) {
            const lo = Math.floor(Math.pow(b / N, 1.8) * maxBin);
            const hi = Math.floor(Math.pow((b + 1) / N, 1.8) * maxBin);
            let sum = 0;
            const count = Math.max(hi - lo, 1);
            for (let k = lo; k < hi; k++) sum += freqBuf[k] ?? 0;
            // 2× gain + clamp
            levels.push(Math.min(1, (sum / count / 255) * 2));
          }
        } else {
          for (let b = 0; b < N; b++) {
            levels.push(
              Math.max(
                0,
                0.35 + Math.sin(now / 300 + b * 0.7) * 0.3 + Math.sin(now / 180 + b * 1.3) * 0.2,
              ),
            );
          }
        }

        // smooth: attack fast (0.6), decay slow (0.1)
        const smoothed = barLevelsRef.current;
        for (let b = 0; b < N; b++) {
          const raw = levels[b] ?? 0;
          const prev = smoothed[b] ?? 0;
          smoothed[b] = raw > prev ? prev * 0.4 + raw * 0.6 : prev * 0.88 + raw * 0.12;
          levels[b] = smoothed[b] ?? 0;
        }

        const holds = peakHoldsRef.current;
        // segmented pixel-art bars: each bar divided into discrete blocks
        const SEGS = 14;
        const segH = Math.floor((sh - SEGS) / SEGS); // block height
        const segGap = 1;

        for (let b = 0; b < N; b++) {
          const level = levels[b] ?? 0;
          holds[b] = Math.max((holds[b] ?? 0) - 0.025, level);
          const litSegs = Math.round(level * SEGS);
          const peakSeg = Math.round((holds[b] ?? 0) * SEGS);
          const x = b * (barW + gap);

          for (let s = 0; s < SEGS; s++) {
            const segY = sh - (s + 1) * (segH + segGap);
            const frac = s / (SEGS - 1); // 0 = bottom, 1 = top

            let color: string;
            if (frac > 0.78) color = '#ff2222';
            else if (frac > 0.55) color = '#ffaa00';
            else if (frac > 0.35) color = '#ffe800';
            else color = '#18e018';

            if (s < litSegs) {
              // lit segment
              sc.shadowColor = color;
              sc.shadowBlur = 3;
              sc.fillStyle = color;
              sc.globalAlpha = 1;
              sc.fillRect(x, segY, barW, segH);
            } else if (s === peakSeg && peakSeg > 0) {
              // peak hold block — bright white flash
              sc.shadowColor = color;
              sc.shadowBlur = 6;
              sc.fillStyle = '#ffffff';
              sc.globalAlpha = 0.9;
              sc.fillRect(x, segY, barW, segH);
            } else {
              // unlit — dark ghost so grid is visible
              sc.shadowBlur = 0;
              sc.fillStyle = color;
              sc.globalAlpha = 0.08;
              sc.fillRect(x, segY, barW, segH);
            }
          }
        }
        sc.globalAlpha = 1;
        sc.shadowBlur = 0;
      }
    }

    rafRef.current = requestAnimationFrame(drawWave);
  }, [spawnLine]);

  const drawFlat = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const { width: w, height: h } = canvas;
    ctx2d.fillStyle = '#060809';
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = '#0d2010';
    for (let gx = 0; gx < w; gx += 4) {
      for (let gy = 0; gy < h; gy += 4) {
        ctx2d.fillRect(gx, gy, 1, 1);
      }
    }
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = '#39ff1433';
    ctx2d.shadowBlur = 0;
    ctx2d.beginPath();
    ctx2d.moveTo(0, h / 2);
    ctx2d.lineTo(w, h / 2);
    ctx2d.stroke();
  }, []);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await initAudio();
    } catch {
      // fall through to plain playback
    }
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }, [initAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setPlaying(true);
      rafRef.current = requestAnimationFrame(drawWave);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      drawFlat();
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => {
      setDuration(audio.duration);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    drawFlat();
    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
    };
  }, [drawWave, drawFlat]);

  return (
    <article className={styles.winamp}>
      <audio ref={audioRef} src={proxySrc} preload="none" crossOrigin="anonymous" />
      {coverSrc ? (
        <img className={styles.winampCover} src={coverSrc} alt="" />
      ) : (
        <div className={styles.winampCover} aria-hidden="true" />
      )}
      <div className={styles.winampBody}>
        <div className={styles.winampMeta}>
          <a
            className={styles.winampTitle}
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {title}
          </a>
          {artist && <span className={styles.winampArtist}>{artist}</span>}
        </div>
        <div className={styles.winampViz}>
          <canvas ref={canvasRef} className={styles.winampCanvas} width={300} height={56} />
          <canvas ref={specCanvasRef} className={styles.winampSpec} width={96} height={56} />
        </div>
        <div className={styles.winampControls}>
          <button
            className={styles.winampBtn}
            onClick={() => void toggle()}
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <input
            className={styles.winampSeek}
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => {
              const audio = audioRef.current;
              if (audio) audio.currentTime = Number(e.target.value);
            }}
          />
          <span className={styles.winampTime}>
            {fmt(currentTime)}&nbsp;/&nbsp;{duration ? fmt(duration) : '--:--'}
          </span>
        </div>
        <a
          className={styles.winampCredit}
          href="https://plyr.fm"
          target="_blank"
          rel="noopener noreferrer"
        >
          powered by plyr.fm
        </a>
      </div>
    </article>
  );
}

/** Audio list — Winamp-style players with live waveform. */
function AudioList({ records, ctx }: { records: RecordItem[]; ctx: RenderContext }) {
  const tracks = records
    .map((r) => {
      const obj =
        r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
      if (!obj) return null;

      // URL-based tracks (e.g. plyr.fm) take priority over blobs
      const audioSrc =
        (typeof obj.audioUrl === 'string' ? obj.audioUrl : null) ??
        (() => {
          const b = collectAudioBlobs(r.value)[0];
          return b ? blobUrl(ctx.pds, ctx.did, b.cid) : null;
        })();
      if (!audioSrc) return null;

      const coverSrc =
        (typeof obj.imageUrl === 'string' ? obj.imageUrl : null) ??
        (() => {
          const b = collectImageBlobs(r.value)[0];
          return b ? blobUrl(ctx.pds, ctx.did, b.cid) : null;
        })();

      const title = pickString(obj, TITLE_FIELDS);
      const artist = pickString(obj, ['artist', 'artistName', 'creator']);
      return { record: r, audioSrc, coverSrc, title, artist };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (tracks.length === 0) return <div className={styles.empty}>—</div>;

  return (
    <div className={styles.tracks}>
      <a
        className={styles.statusCredit}
        href="https://plyr.fm"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by plyr.fm
      </a>
      {tracks.map((tr) => (
        <WinampPlayer
          key={tr.record.uri}
          src={tr.audioSrc}
          coverSrc={tr.coverSrc}
          title={tr.title ?? tr.record.uri.split('/').pop() ?? ''}
          artist={tr.artist}
          linkHref={linkForRecord(tr.record.uri, ctx.handle)}
        />
      ))}
    </div>
  );
}

/** Gallery (Instagram-like): pure image grid, click to view on pdsls. */
function GalleryGrid({ records, ctx }: { records: RecordItem[]; ctx: RenderContext }) {
  // Fetch gallery items to map photo URI → gallery rkey for correct link-out URLs
  const { data: galleryMap = new Map<string, string>() } = useQuery({
    queryKey: ['grainGalleryItems', ctx.pds, ctx.did],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const map = new Map<string, string>();
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({
          repo: ctx.did,
          collection: 'social.grain.gallery.item',
          limit: '100',
        });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.listRecords?${params}`);
        if (!res.ok) break;
        const json = (await res.json()) as { records: Array<{ value: unknown }>; cursor?: string };
        for (const r of json.records) {
          const v =
            r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
          if (typeof v?.item === 'string' && typeof v.gallery === 'string') {
            const galleryRkey = v.gallery.split('/').pop() ?? '';
            if (galleryRkey) map.set(v.item, galleryRkey);
          }
        }
        cursor = json.cursor;
      } while (cursor);
      return map;
    },
  });

  const tiles = records
    .map((r) => {
      const blob = collectImageBlobs(r.value)[0];
      if (!blob) return null;
      const obj =
        r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
      const alt = typeof obj?.alt === 'string' ? obj.alt : '';
      const did = r.uri.split('/')[2] ?? ctx.did;
      const galleryRkey = galleryMap.get(r.uri);
      const href = galleryRkey
        ? `https://grain.social/profile/${did}/gallery/${galleryRkey}`
        : linkForRecord(r.uri, ctx.handle);
      return { uri: r.uri, cid: blob.cid, alt, href };
    })
    .filter((x): x is { uri: string; cid: string; alt: string; href: string } => x !== null);

  if (tiles.length === 0) return <div className={styles.empty}>—</div>;

  return (
    <>
      <a
        className={styles.statusCredit}
        href="https://grain.social"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by grain.social
      </a>
      <div className={styles.gallery}>
        {tiles.map((tile) => (
          <a
            key={tile.uri}
            className={styles.galleryTile}
            href={tile.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={blobUrl(ctx.pds, ctx.did, tile.cid)} alt={tile.alt} loading="lazy" />
            {tile.alt && <span className={styles.galleryAlt}>{tile.alt}</span>}
          </a>
        ))}
      </div>
    </>
  );
}

function StatusList({ records, did }: { records: RecordItem[]; did: string }) {
  if (records.length === 0) return <div className={styles.empty}>—</div>;

  return (
    <div className={styles.statusList}>
      <a
        className={styles.statusCredit}
        href="https://status.zzstoatzz.io/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by status.zzstoatzz.io
      </a>
      {records.map((r) => {
        const obj =
          r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
        const emoji = typeof obj?.emoji === 'string' ? obj.emoji : null;
        const text = typeof obj?.text === 'string' ? obj.text : null;
        const createdAt = typeof obj?.createdAt === 'string' ? obj.createdAt : null;
        const parts = r.uri.split('/');
        const rkey = parts[parts.length - 1] ?? '';
        const isCustom = emoji?.startsWith('custom:') === true;
        const emojiName = isCustom && emoji ? emoji.slice('custom:'.length) : null;
        const href = `https://status.zzstoatzz.io/status/${did}/${rkey}`;

        return (
          <a
            key={r.uri}
            className={styles.statusEntry}
            // eslint-disable-next-line no-restricted-syntax -- constructed from trusted base URL + DID + rkey
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {emojiName ? (
              <img
                className={styles.statusEntryEmoji}
                src={`https://all-the.bufo.zone/${emojiName}.png`}
                alt={emojiName}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.endsWith('.gif'))
                    img.src = `https://all-the.bufo.zone/${emojiName}.gif`;
                }}
              />
            ) : (
              <span className={styles.statusEntryEmojiText}>{emoji}</span>
            )}
            <div className={styles.statusEntryBody}>
              {text && <div className={styles.statusEntryText}>{text}</div>}
              {createdAt && <div className={styles.postMeta}>{formatDate(createdAt)}</div>}
            </div>
          </a>
        );
      })}
    </div>
  );
}

function blobCid(blob: unknown): string | null {
  if (!blob || typeof blob !== 'object') return null;
  const ref = (blob as Record<string, unknown>).ref;
  if (!ref || typeof ref !== 'object') return null;
  const link = (ref as Record<string, unknown>).$link;
  return typeof link === 'string' ? link : null;
}

function RPGItemCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const title = typeof obj?.title === 'string' ? obj.title : null;
  const description = typeof obj?.description === 'string' ? obj.description : null;
  const context = typeof obj?.context === 'string' ? obj.context : null;
  const category = typeof obj?.category === 'string' ? obj.category : null;
  const acceptedAt = typeof obj?.acceptedAt === 'string' ? obj.acceptedAt : null;

  const iconCid = blobCid(obj?.icon);
  const iconSrc = iconCid ? blobUrl(ctx.pds, ctx.did, iconCid) : null;

  return (
    <article className={styles.rpgItemCard}>
      <div className={styles.rpgItemImgWrap}>
        {iconSrc && (
          <img className={styles.rpgItemImg} src={iconSrc} alt={title ?? ''} loading="lazy" />
        )}
      </div>
      <div className={styles.rpgItemBody}>
        {title && <div className={styles.recordTitle}>{title}</div>}
        {category && <span className={styles.rpgCategoryBadge}>{category}</span>}
        {description && <div className={styles.postText}>{description}</div>}
        {context && <div className={styles.postMeta}>{context}</div>}
        <div className={styles.postMeta}>{acceptedAt ? formatDate(acceptedAt) : null}</div>
      </div>
    </article>
  );
}

function RPGItemsTab({
  ctx,
  scrollRef,
}: {
  ctx: RenderContext;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, error } =
    useActorRecords(ctx.did, 'equipment.rpg.item');

  useScrollHandler(
    scrollRef,
    useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (
        hasNextPage &&
        !isFetchingNextPage &&
        el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
      ) {
        void fetchNextPage();
      }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrollRef]),
  );

  if (isLoading) return <div className={styles.loading}>{t('buddyList.loading')}</div>;
  if (error) return <div className={styles.error}>{t('errorBoundary.fallbackMessage')}</div>;

  const records = (data?.pages.flatMap((p) => p.records) ?? []) as RecordItem[];
  if (records.length === 0) return <div className={styles.empty}>—</div>;

  return (
    <>
      <a
        className={styles.statusCredit}
        href="https://rpg.actor"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by rpg.actor
      </a>
      <div className={styles.rpgItemGrid}>
        {records.map((r) => (
          <RPGItemCard key={r.uri} record={r} ctx={ctx} />
        ))}
      </div>
      {isFetchingNextPage && <div className={styles.loadingMore}>{t('buddyList.loading')}</div>}
    </>
  );
}

function useKeytraceVerified(did: string | undefined): boolean {
  // Reuse the same query as the keytrace tab — no separate PDS resolution needed.
  const { data } = useActorRecords(did, 'dev.keytrace.claim');
  const records = data?.pages.flatMap((p) => p.records) ?? [];
  return records.some((r) => {
    const v = r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : null;
    // absent status = legacy record, treated as verified per keytrace schema
    return !v?.status || v.status === 'verified';
  });
}

const PLATFORM_LABELS: Record<string, string> = {
  github: 'GitHub',
  twitter: 'Twitter / X',
  discord: 'Discord',
  domain: 'Domain',
};

function KeytraceCardAvatar({
  avatarUrl,
  ctx,
  profileAvatar,
}: {
  avatarUrl: string | null;
  ctx: RenderContext;
  profileAvatar: string | undefined;
}) {
  const { data: sprite } = useActorSprite(ctx.did, ctx.pds);
  const hasSpriteHead = !!sprite?.spriteSheet.ref.$link;
  const [imgFailed, setImgFailed] = useState(false);

  if (avatarUrl && !imgFailed) {
    return (
      <img
        className={styles.keytraceAvatar}
        src={avatarUrl}
        alt=""
        loading="lazy"
        onError={() => {
          setImgFailed(true);
        }}
      />
    );
  }
  if (hasSpriteHead) {
    return <SpriteHead pds={ctx.pds} did={ctx.did} size={56} />;
  }
  if (profileAvatar) {
    return <img className={styles.keytraceAvatar} src={profileAvatar} alt="" loading="lazy" />;
  }
  return <div className={styles.keytraceAvatarPlaceholder} />;
}

function KeytraceCard({
  record,
  ctx,
  profileAvatar,
}: {
  record: RecordItem;
  ctx: RenderContext;
  profileAvatar: string | undefined;
}) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const type = typeof obj?.type === 'string' ? obj.type : null;
  const status = typeof obj?.status === 'string' ? obj.status : null;
  const claimUri =
    typeof obj?.claimUri === 'string' && isSafeUrl(obj.claimUri) ? obj.claimUri : null;
  const identity =
    obj?.identity && typeof obj.identity === 'object'
      ? (obj.identity as Record<string, unknown>)
      : null;
  const subject = typeof identity?.subject === 'string' ? identity.subject : null;
  const profileUrl =
    typeof identity?.profileUrl === 'string' && isSafeUrl(identity.profileUrl)
      ? identity.profileUrl
      : null;
  const avatarUrl =
    typeof identity?.avatarUrl === 'string' && isSafeUrl(identity.avatarUrl)
      ? identity.avatarUrl
      : null;
  const lastVerifiedAt = typeof obj?.lastVerifiedAt === 'string' ? obj.lastVerifiedAt : null;
  // absent status = legacy record, treated as verified per keytrace schema
  const isVerified = !status || status === 'verified';

  return (
    <article className={styles.keytraceCard}>
      <KeytraceCardAvatar avatarUrl={avatarUrl} ctx={ctx} profileAvatar={profileAvatar} />
      <div className={styles.keytraceInfo}>
        <div className={styles.keytraceHeader}>
          <span className={styles.keytracePlatform}>
            {type ? (PLATFORM_LABELS[type] ?? type) : '—'}
          </span>
          {isVerified && <span className={styles.keytraceCheck}>✓</span>}
          {!isVerified && status && <span className={styles.keytraceStatus}>{status}</span>}
        </div>
        {subject && profileUrl ? (
          <a
            className={styles.keytraceSubject}
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{subject}
          </a>
        ) : subject ? (
          <span className={styles.keytraceSubject}>@{subject}</span>
        ) : null}
        {claimUri && (
          <a
            className={styles.recordLink}
            href={claimUri}
            target="_blank"
            rel="noopener noreferrer"
          >
            Claim <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      {lastVerifiedAt && <span className={styles.keytraceDate}>{formatDate(lastVerifiedAt)}</span>}
    </article>
  );
}

function TangledRepoCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const name = typeof obj?.name === 'string' ? obj.name : null;
  const description = typeof obj?.description === 'string' ? obj.description : null;
  const knot = typeof obj?.knot === 'string' ? obj.knot : null;
  const website = typeof obj?.website === 'string' && isSafeUrl(obj.website) ? obj.website : null;
  const createdAt = typeof obj?.createdAt === 'string' ? obj.createdAt : null;
  const href = name
    ? `https://tangled.org/${ctx.handle}/${name}`
    : linkForRecord(record.uri, ctx.handle);

  return (
    <article className={styles.post}>
      <div className={styles.tangledRepoHeader}>
        <a className={styles.tangledRepoName} href={href} target="_blank" rel="noopener noreferrer">
          {name ?? record.uri.split('/').pop()}
        </a>
        {knot && <span className={styles.tangledKnot}>{knot}</span>}
      </div>
      {description && <div className={styles.postText}>{description}</div>}
      <div className={styles.cardFooter}>
        <span className={styles.postMeta}>{createdAt ? formatDate(createdAt) : null}</span>
        <div className={styles.tangledLinks}>
          {website && (
            <a
              className={styles.recordLink}
              href={website}
              target="_blank"
              rel="noopener noreferrer"
            >
              {new URL(website).hostname} <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          <a className={styles.recordLink} href={href} target="_blank" rel="noopener noreferrer">
            View <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}

function TealCard({ record, ctx }: { record: RecordItem; ctx: RenderContext }) {
  const obj =
    record.value && typeof record.value === 'object'
      ? (record.value as Record<string, unknown>)
      : null;
  const trackName = typeof obj?.trackName === 'string' ? obj.trackName : null;
  const releaseName = typeof obj?.releaseName === 'string' ? obj.releaseName : null;
  const releaseMbId = typeof obj?.releaseMbId === 'string' ? obj.releaseMbId : null;
  const playedTime = typeof obj?.playedTime === 'string' ? obj.playedTime : null;
  const artists = Array.isArray(obj?.artists)
    ? (obj.artists as unknown[])
        .map((a) => {
          const ao = a && typeof a === 'object' ? (a as Record<string, unknown>) : null;
          return typeof ao?.artistName === 'string' ? ao.artistName : null;
        })
        .filter((a): a is string => a !== null)
    : [];
  const artistStr = artists.join(', ');
  const artSrc = releaseMbId
    ? `https://coverartarchive.org/release/${releaseMbId}/front-250`
    : null;

  return (
    <article className={styles.tealCard}>
      {artSrc && <img className={styles.tealArt} src={artSrc} alt="" loading="lazy" />}
      <div className={styles.tealBody}>
        {trackName && <div className={styles.recordTitle}>{trackName}</div>}
        <div className={styles.postText}>
          {artistStr}
          {releaseName && <span className={styles.tealRelease}> — {releaseName}</span>}
        </div>
        <div className={styles.cardFooter}>
          <span className={styles.postMeta}>{playedTime ? formatDate(playedTime) : null}</span>
          <a
            className={styles.recordLink}
            href={linkForRecord(record.uri, ctx.handle)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}

function FeedTab({
  actor,
  scrollRef,
}: {
  actor: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['authorFeed', actor],
    queryFn: async ({ pageParam }) => {
      const res = await publicAgent.app.bsky.feed.getAuthorFeed({
        actor,
        filter: 'posts_no_replies',
        limit: 30,
        cursor: pageParam,
      });
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!actor,
  });

  useScrollHandler(
    scrollRef,
    useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (
        hasNextPage &&
        !isFetchingNextPage &&
        el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
      ) {
        void fetchNextPage();
      }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrollRef]),
  );

  const posts = data?.pages.flatMap((p) => p.feed) ?? [];
  return (
    <>
      {posts.map((item) => (
        <PostCard key={item.post.uri} item={item} />
      ))}
      {isFetchingNextPage && <div className={styles.loadingMore}>{t('buddyList.loading')}</div>}
    </>
  );
}

/** Single-collection records tab — uses infinite scroll. */
function SingleCollectionTab({
  ctx,
  collection,
  render,
  scrollRef,
  profileAvatar,
}: {
  ctx: RenderContext;
  collection: string;
  render: RenderKind;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  profileAvatar?: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, error } =
    useActorRecords(ctx.did, collection);

  useScrollHandler(
    scrollRef,
    useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (
        hasNextPage &&
        !isFetchingNextPage &&
        el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
      ) {
        void fetchNextPage();
      }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrollRef]),
  );

  if (isLoading) return <div className={styles.loading}>{t('buddyList.loading')}</div>;
  if (error) return <div className={styles.error}>{t('errorBoundary.fallbackMessage')}</div>;
  const records = (data?.pages.flatMap((p) => p.records) ?? []) as RecordItem[];
  if (records.length === 0) return <div className={styles.empty}>—</div>;

  return (
    <>
      {render === 'arabica' && (
        <a
          className={styles.statusCredit}
          href="https://alpha.arabica.social"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by arabica.social
        </a>
      )}
      {render === 'teal' && (
        <a
          className={styles.statusCredit}
          href="https://teal.fm"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by teal.fm
        </a>
      )}
      {render === 'tangled' && (
        <a
          className={styles.statusCredit}
          href="https://tangled.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by tangled.sh
        </a>
      )}
      {render === 'keytrace' && (
        <a
          className={styles.statusCredit}
          href="https://keytrace.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by keytrace.dev
        </a>
      )}
      {render === 'gallery' ? (
        <GalleryGrid records={records} ctx={ctx} />
      ) : render === 'audio' ? (
        <AudioList records={records} ctx={ctx} />
      ) : render === 'status' ? (
        <StatusList records={records} did={ctx.did} />
      ) : render === 'teal' ? (
        records.map((r) => <TealCard key={r.uri} record={r} ctx={ctx} />)
      ) : render === 'tangled' ? (
        records.map((r) => <TangledRepoCard key={r.uri} record={r} ctx={ctx} />)
      ) : render === 'keytrace' ? (
        <div className={styles.rpgItemGrid}>
          {records.map((r) => (
            <KeytraceCard key={r.uri} record={r} ctx={ctx} profileAvatar={profileAvatar} />
          ))}
        </div>
      ) : (
        records.map((r) =>
          render === 'publications' ? (
            <PublicationCard key={r.uri} record={r} ctx={ctx} />
          ) : (
            <DefaultCard key={r.uri} record={r} ctx={ctx} />
          ),
        )
      )}
      {isFetchingNextPage && <div className={styles.loadingMore}>{t('buddyList.loading')}</div>}
    </>
  );
}

/** Multi-collection tab — fetches one page from each, sorts by createdAt desc. */
function MultiCollectionTab({
  ctx,
  collections,
  render,
  profileAvatar,
}: {
  ctx: RenderContext;
  collections: string[];
  render: RenderKind;
  profileAvatar?: string;
}) {
  const { t } = useTranslation();
  const queries = useQueries({
    queries: collections.map((c) => ({
      queryKey: ['actorRecordsSingle', ctx.did, c],
      queryFn: async () => {
        const params = new URLSearchParams({ repo: ctx.did, collection: c, limit: '30' });
        const res = await fetch(`${ctx.pds}/xrpc/com.atproto.repo.listRecords?${params}`);
        if (!res.ok) throw new Error(`listRecords failed: ${res.status}`);
        const data = (await res.json()) as { records: RecordItem[] };
        return data.records;
      },
      staleTime: 60_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const records = queries.flatMap((q) => q.data ?? []);
  records.sort((a, b) => {
    const av =
      a.value && typeof a.value === 'object'
        ? (((a.value as Record<string, unknown>).createdAt as string | undefined) ?? '')
        : '';
    const bv =
      b.value && typeof b.value === 'object'
        ? (((b.value as Record<string, unknown>).createdAt as string | undefined) ?? '')
        : '';
    return bv.localeCompare(av);
  });

  if (isLoading && records.length === 0)
    return <div className={styles.loading}>{t('buddyList.loading')}</div>;
  if (records.length === 0) return <div className={styles.empty}>—</div>;

  if (render === 'gallery') return <GalleryGrid records={records} ctx={ctx} />;
  if (render === 'audio') return <AudioList records={records} ctx={ctx} />;

  const displayRecords =
    render === 'card'
      ? [...records].sort((a, b) => {
          const aObj =
            a.value && typeof a.value === 'object' ? (a.value as Record<string, unknown>) : null;
          const bObj =
            b.value && typeof b.value === 'object' ? (b.value as Record<string, unknown>) : null;
          const tier = (o: Record<string, unknown> | null) => {
            if (o?.$type !== 'social.popfeed.feed.list') return 2; // reviews etc.
            if (typeof o.listType === 'string' && o.listType.startsWith('currently_')) return 0;
            return 1; // other lists
          };
          const ta = tier(aObj),
            tb = tier(bObj);
          if (ta !== tb) return ta - tb;
          const aDate = typeof aObj?.createdAt === 'string' ? aObj.createdAt : '';
          const bDate = typeof bObj?.createdAt === 'string' ? bObj.createdAt : '';
          return bDate.localeCompare(aDate);
        })
      : records;

  return (
    <>
      {render === 'card' && (
        <a
          className={styles.statusCredit}
          href="https://popfeed.social"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by Popfeed
        </a>
      )}
      {render === 'publications' && (
        <a
          className={styles.statusCredit}
          href="https://standard.site"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by standard.site
        </a>
      )}
      {render === 'arabica' && (
        <a
          className={styles.statusCredit}
          href="https://alpha.arabica.social"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by arabica.social
        </a>
      )}
      {render === 'teal' && (
        <a
          className={styles.statusCredit}
          href="https://teal.fm"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by teal.fm
        </a>
      )}
      {render === 'tangled' && (
        <a
          className={styles.statusCredit}
          href="https://tangled.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by tangled.sh
        </a>
      )}
      {render === 'keytrace' ? (
        <div className={styles.rpgItemGrid}>
          {displayRecords.map((r) => (
            <KeytraceCard key={r.uri} record={r} ctx={ctx} profileAvatar={profileAvatar} />
          ))}
        </div>
      ) : null}
      {render !== 'keytrace' &&
        displayRecords.map((r) => {
          if (render === 'teal') return <TealCard key={r.uri} record={r} ctx={ctx} />;
          if (render === 'tangled') return <TangledRepoCard key={r.uri} record={r} ctx={ctx} />;
          if (render === 'publications')
            return <PublicationCard key={r.uri} record={r} ctx={ctx} />;
          if (render === 'card') {
            const type =
              r.value && typeof r.value === 'object'
                ? (r.value as Record<string, unknown>).$type
                : null;
            if (type === 'social.popfeed.feed.review')
              return <PopfeedReviewCard key={r.uri} record={r} ctx={ctx} />;
            if (type === 'social.popfeed.feed.list')
              return <PopfeedListCard key={r.uri} record={r} ctx={ctx} />;
            if (type === 'social.popfeed.feed.listItem')
              return <PopfeedItemCard key={r.uri} record={r} ctx={ctx} />;
          }
          return <DefaultCard key={r.uri} record={r} ctx={ctx} />;
        })}
    </>
  );
}

function useScrollHandler(ref: React.RefObject<HTMLDivElement | null>, handler: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', handler, { passive: true });
    return () => {
      el.removeEventListener('scroll', handler);
    };
  }, [ref, handler]);
}

/** Resolve PDS once per DID (cached by react-query). */
function usePds(did: string | undefined) {
  return useQuery({
    queryKey: ['pds', did],
    enabled: !!did,
    staleTime: 60 * 60 * 1000,
    queryFn: () => resolvePdsForDid(did as string),
  });
}

export function ProfileView({ actor, onBack }: ProfileViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [cursorDir, setCursorDir] = useState<'left' | 'right' | 'up' | 'down' | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const gameSeqRef = useRef<string[]>([]);

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['profile', actor],
    queryFn: async () => {
      const res = await publicAgent.app.bsky.actor.getProfile({ actor });
      return res.data;
    },
    enabled: !!actor,
  });

  const { did: viewerDid } = useAuth();
  const { data: viewerPds } = usePds(viewerDid ?? undefined);

  const { canMessage: germAvailable, germUrl } = useGermDeclaration(profile?.did);
  const { data: collectionsData } = useActorCollections(profile?.did);
  const { data: pds } = usePds(profile?.did);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const next = [...gameSeqRef.current, e.key].slice(-GAME_SEQ.length);
      gameSeqRef.current = next;
      if (next.join(',') === GAME_SEQ.join(',')) {
        setGameOpen(true);
        gameSeqRef.current = [];
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);

  const handleHeaderMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    if (Math.abs(cx - mx) > Math.abs(cy - my)) {
      setCursorDir(cx > mx ? 'right' : 'left');
    } else {
      setCursorDir(cy > my ? 'down' : 'up');
    }
  }, []);

  const tabs = useMemo<TabSpec[]>(() => {
    const cols = collectionsData?.collections ?? [];
    const present = new Set<string>(cols);
    const usedTabs = new Set<LexiconTab>();
    for (const c of cols) {
      const tab = tabForCollection(c);
      if (tab) usedTabs.add(tab);
    }
    return LEXICON_TABS.filter((tab) => usedTabs.has(tab)).map((tab) => ({
      id: tab.id,
      label: tab.label,
      collections: tab.collections.filter((c) => present.has(c)),
      render: tab.render,
    }));
  }, [collectionsData]);

  useEffect(() => {
    if (!profile) return;
    const el = headerRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setPinned(!(entry?.isIntersecting ?? true));
      },
      { root: container, threshold: 0 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, [profile]);

  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  const ctx: RenderContext | null =
    profile && pds ? { pds, did: profile.did, handle: profile.handle } : null;

  const isKeytracVerified = useKeytraceVerified(profile?.did);

  return (
    <div className={styles.profileView}>
      <div className={styles.scrollArea} ref={scrollRef}>
        <button className={styles.backButton} onClick={onBack} type="button">
          <ArrowLeft size={14} /> {t('button.back')}
        </button>

        {isLoading && <div className={styles.loading}>{t('buddyList.loading')}</div>}
        {error && <div className={styles.error}>{t('errorBoundary.fallbackMessage')}</div>}

        {profile && (
          <div
            className={styles.profileHeader}
            ref={headerRef}
            onMouseMove={handleHeaderMouseMove}
            onMouseLeave={() => {
              setCursorDir(null);
            }}
          >
            {profile.banner && isSafeUrl(profile.banner) ? (
              // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
              <img className={styles.banner} src={profile.banner} alt="" />
            ) : (
              <div className={styles.banner} />
            )}
            <div className={styles.profileInfo}>
              <div className={styles.avatarRow}>
                {profile.avatar && isSafeUrl(profile.avatar) ? (
                  // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
                  <img className={styles.profileAvatar} src={profile.avatar} alt="" />
                ) : (
                  <div className={styles.profileAvatar} />
                )}
                <div className={styles.names}>
                  <div className={styles.profileDisplayName}>
                    {profile.displayName || profile.handle}
                  </div>
                  <div className={styles.profileHandle}>
                    @{profile.handle}
                    {isKeytracVerified && (
                      <span className={styles.verifiedBadge} title="Verified by keytrace.dev">
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {profile.description && <div className={styles.bio}>{profile.description}</div>}

              <div className={styles.stats}>
                <span>
                  <span className={styles.statCount}>{profile.followersCount ?? 0}</span>{' '}
                  {t('buddyList.groups.followers')}
                </span>
                <span>
                  <span className={styles.statCount}>{profile.followsCount ?? 0}</span>{' '}
                  {t('buddyList.groups.following')}
                </span>
              </div>

              {germAvailable && germUrl && (
                <div className={styles.profileActions}>
                  <a
                    className={styles.germButton}
                    // eslint-disable-next-line no-restricted-syntax -- germUrl validated by isSafeUrl() in useGermDeclaration
                    href={germUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      className={styles.germLogo}
                      src="/images/germ_logo.webp"
                      alt=""
                      width={16}
                      height={16}
                    />
                    {t('buddyMenu.messageOnGerm')}
                  </a>
                </div>
              )}
            </div>
            {ctx && (
              <SpriteWalker
                pds={ctx.pds}
                did={ctx.did}
                statusText={profile.description ?? undefined}
                viewerDid={viewerDid}
                viewerPds={viewerPds ?? null}
                cursorDir={cursorDir}
              />
            )}
            {ctx && <StatusBadge pds={ctx.pds} did={ctx.did} />}
          </div>
        )}
        {gameOpen && ctx && (
          <div
            className={styles.gameOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Runner game"
          >
            <div className={styles.gameModal}>
              <RunnerGame
                onClose={() => {
                  setGameOpen(false);
                }}
                did={ctx.did}
                pds={ctx.pds}
                difficulty="fast"
              />
            </div>
          </div>
        )}

        {profile && (
          <div className={`${styles.stickyBar} ${pinned ? styles.stickyBarPinned : ''}`}>
            <div className={styles.condensedHeader}>
              <div className={styles.condensedHeaderInner}>
                {profile.banner && isSafeUrl(profile.banner) ? (
                  <img
                    className={styles.condensedBannerBg}
                    src={profile.banner}
                    alt=""
                    aria-hidden="true"
                  />
                ) : (
                  <div className={styles.condensedBannerBg} />
                )}
                <div className={styles.condensedInfo}>
                  {profile.avatar && isSafeUrl(profile.avatar) ? (
                    // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
                    <img className={styles.condensedAvatar} src={profile.avatar} alt="" />
                  ) : (
                    <div className={styles.condensedAvatar} />
                  )}
                  <span className={styles.condensedName}>
                    {profile.displayName || profile.handle}
                    {isKeytracVerified && (
                      <span className={styles.verifiedBadge} title="Verified by keytrace.dev">
                        ✓
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            {tabs.length > 1 && (
              <div className={styles.tabs} role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    type="button"
                    aria-selected={(active?.id ?? null) === tab.id}
                    className={`${styles.tab} ${(active?.id ?? null) === tab.id ? styles.tabActive : ''}`}
                    onClick={() => {
                      setActiveTabId(tab.id);
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {profile && active && (
          <div className={styles.postsSection}>
            {active.render === 'feed' ? (
              <FeedTab actor={actor} scrollRef={scrollRef} />
            ) : active.render === 'rpg' && ctx ? (
              <RPGItemsTab ctx={ctx} scrollRef={scrollRef} />
            ) : ctx ? (
              active.collections.length === 1 ? (
                <SingleCollectionTab
                  ctx={ctx}
                  collection={active.collections[0] ?? ''}
                  render={active.render}
                  scrollRef={scrollRef}
                  profileAvatar={profile.avatar}
                />
              ) : (
                <MultiCollectionTab
                  ctx={ctx}
                  collections={active.collections}
                  render={active.render}
                  profileAvatar={profile.avatar}
                />
              )
            ) : (
              <div className={styles.loading}>{t('buddyList.loading')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
