import { memo, type ReactNode } from 'react';
import { isSafeUrl } from '../../lib/sanitize';
import styles from './RichText.module.css';

/** Facet shape shared by protoimsg and Bluesky records. */
export interface GenericFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; [key: string]: unknown }>;
}

interface RichTextProps {
  text: string;
  /**
   * Untrusted: DMs arrive peer-to-peer, so this may be any JSON at all.
   * Everything is validated here — malformed input degrades to plain text,
   * never a crash.
   */
  facets?: unknown;
}

/** Bounds per-render work against a peer sending a flood of facets. */
const MAX_FACETS = 100;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Range {
  start: number;
  end: number;
  features: Array<{ $type: string; [key: string]: unknown }>;
}

const BLOCK_TYPES = new Set([
  'app.protoimsg.chat.message#blockquote',
  'app.protoimsg.chat.message#codeBlock',
]);
const LINK_TYPES = new Set(['app.protoimsg.chat.message#link', 'app.bsky.richtext.facet#link']);
const MENTION_TYPES = new Set([
  'app.protoimsg.chat.message#mention',
  'app.bsky.richtext.facet#mention',
]);
const TAG_TYPES = new Set(['app.protoimsg.chat.message#tag', 'app.bsky.richtext.facet#tag']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Keep only structurally valid facets, as byte ranges. */
function sanitize(facets: unknown, byteLen: number): Range[] {
  if (!Array.isArray(facets)) return [];
  const out: Range[] = [];
  for (const f of facets.slice(0, MAX_FACETS)) {
    if (!isRecord(f) || !isRecord(f.index) || !Array.isArray(f.features)) continue;
    const { byteStart, byteEnd } = f.index;
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd)) continue;
    const start = byteStart as number;
    const end = byteEnd as number;
    if (start < 0 || start >= end || end > byteLen) continue;
    const features = f.features.filter(
      (x): x is { $type: string } => isRecord(x) && typeof x.$type === 'string',
    );
    if (features.length > 0) out.push({ start, end, features });
  }
  return out;
}

/**
 * A link is only clickable when its visible text names its destination.
 * Facets come from the sender's client, so `text: "chase.com"` with
 * `uri: "https://evil.example"` would otherwise be a one-tap phishing link.
 */
function linkMatchesText(uri: string, text: string): boolean {
  const strip = (s: string) =>
    s
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/(\.\.\.|…)$/, '')
      .toLowerCase();
  const shown = strip(text);
  return shown.length > 0 && strip(uri).startsWith(shown);
}

function safeLinkUri(features: Range['features'], text: string): string | null {
  for (const f of features) {
    if (!LINK_TYPES.has(f.$type) || typeof f.uri !== 'string') continue;
    if (isSafeUrl(f.uri) && linkMatchesText(f.uri, text)) return f.uri;
  }
  return null;
}

/** Wrap one inline piece in every feature that covers it; the link goes outermost. */
function renderPiece(text: string, features: Range['features'], linkText: string, key: number) {
  const types = new Set(features.map((f) => f.$type));
  let node: ReactNode = text;
  if (types.has('app.protoimsg.chat.message#codeInline')) {
    node = <code className={styles.codeInline}>{node}</code>;
  }
  if (types.has('app.protoimsg.chat.message#strikethrough')) node = <del>{node}</del>;
  if (types.has('app.protoimsg.chat.message#italic')) node = <em>{node}</em>;
  if (types.has('app.protoimsg.chat.message#bold')) node = <strong>{node}</strong>;
  if ([...types].some((t) => TAG_TYPES.has(t))) {
    node = <span className={styles.tag}>{node}</span>;
  } else if ([...types].some((t) => MENTION_TYPES.has(t))) {
    node = <span className={styles.mention}>{node}</span>;
  }
  const uri = safeLinkUri(features, linkText);
  if (uri) {
    node = (
      // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() in safeLinkUri
      <a href={uri} target="_blank" rel="noopener noreferrer" className={styles.link}>
        {node}
      </a>
    );
  }
  return <span key={key}>{node}</span>;
}

/**
 * Render bytes [from, to) with inline facets. Overlapping facets nest rather
 * than drop: the text is split at every facet boundary and each piece gets
 * every feature covering it — so `**https://x.co**` is a bold link.
 */
function renderInline(bytes: Uint8Array, from: number, to: number, ranges: Range[]): ReactNode[] {
  const inRange = ranges.filter((r) => r.start < to && r.end > from);
  const cuts = new Set([from, to]);
  for (const r of inRange) {
    cuts.add(Math.max(r.start, from));
    cuts.add(Math.min(r.end, to));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] ?? from;
    const b = points[i + 1] ?? to;
    const text = decoder.decode(bytes.slice(a, b));
    const covering = inRange.filter((r) => r.start <= a && r.end >= b);
    if (covering.length === 0) {
      out.push(text);
      continue;
    }
    // A link's match check uses the text of the whole link range, not the piece.
    const linkRange = covering.find((r) => r.features.some((f) => LINK_TYPES.has(f.$type)));
    const linkText = linkRange
      ? decoder.decode(bytes.slice(Math.max(linkRange.start, from), Math.min(linkRange.end, to)))
      : '';
    out.push(
      renderPiece(
        text,
        covering.flatMap((r) => r.features),
        linkText,
        a,
      ),
    );
  }
  return out;
}

/**
 * Renders text with atproto facets (mentions, links, tags, formatting).
 * Byte offsets are UTF-8 (TextEncoder/TextDecoder). Supports both protoimsg
 * and Bluesky facet shapes.
 *
 * Accents (links, mentions, tags, quotes, code) derive from `currentColor`, so
 * they stay legible on any background the text sits on — e.g. your own DM
 * bubble, whose background IS the theme's primary color (issue #43).
 */
export const RichText = memo(function RichText({ text, facets }: RichTextProps) {
  if (typeof text !== 'string') return null;
  const bytes = encoder.encode(text);
  const ranges = sanitize(facets, bytes.length);
  if (ranges.length === 0) return <>{text}</>;

  const isBlock = (r: Range) => r.features.some((f) => BLOCK_TYPES.has(f.$type));
  const inline = ranges.filter((r) => !isBlock(r));
  // Block ranges (quotes, code blocks) wrap whole lines, so they can't nest
  // by splitting — keep the first of any overlapping ones.
  const blocks: Range[] = [];
  for (const r of ranges.filter(isBlock).sort((a, b) => a.start - b.start)) {
    const last = blocks[blocks.length - 1];
    if (!last || r.start >= last.end) blocks.push(r);
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const block of blocks) {
    // Newlines touching a block are implied by display: block — drop them so
    // pre-wrap bubbles don't show blank lines around quotes.
    let gapStart = cursor;
    if (cursor > 0 && bytes[gapStart] === 0x0a) gapStart++;
    let gapEnd = block.start;
    if (gapEnd > gapStart && bytes[gapEnd - 1] === 0x0a) gapEnd--;
    if (gapEnd > gapStart) out.push(...renderInline(bytes, gapStart, gapEnd, inline));
    const isCode = block.features.some((f) => f.$type === 'app.protoimsg.chat.message#codeBlock');
    const children = renderInline(bytes, block.start, block.end, inline);
    out.push(
      isCode ? (
        <code key={`b${String(block.start)}`} className={styles.codeBlock}>
          {children}
        </code>
      ) : (
        <span key={`b${String(block.start)}`} className={styles.blockquote}>
          {children}
        </span>
      ),
    );
    cursor = block.end;
  }
  let tail = cursor;
  if (cursor > 0 && blocks.length > 0 && bytes[tail] === 0x0a) tail++;
  if (tail < bytes.length) out.push(...renderInline(bytes, tail, bytes.length, inline));
  return <>{out}</>;
});
