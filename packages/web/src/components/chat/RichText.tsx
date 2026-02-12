import type { RichTextFacet, MentionFeature, LinkFeature } from '@protoimsg/lexicon';
import type { ReactNode } from 'react';
import { isSafeUrl } from '../../lib/sanitize';
import styles from './RichText.module.css';

/** Bluesky facet feature types */
interface BskyMentionFeature {
  $type: 'app.bsky.richtext.facet#mention';
  did: string;
}

interface BskyLinkFeature {
  $type: 'app.bsky.richtext.facet#link';
  uri: string;
}

interface BskyTagFeature {
  $type: 'app.bsky.richtext.facet#tag';
  tag: string;
}

type AnyFeature =
  | MentionFeature
  | LinkFeature
  | BskyMentionFeature
  | BskyLinkFeature
  | BskyTagFeature;

/** Facet shape shared by both protoimsg and Bluesky records */
export interface GenericFacet {
  index: { byteStart: number; byteEnd: number };
  features: AnyFeature[];
}

interface RichTextProps {
  text: string;
  facets?: RichTextFacet[] | GenericFacet[];
  onMentionClick?: (did: string) => void;
}

function renderFeature(
  feature: AnyFeature,
  text: string,
  key: number,
  onMentionClick?: (did: string) => void,
): ReactNode {
  switch (feature.$type) {
    case 'app.protoimsg.chat.message#mention':
    case 'app.bsky.richtext.facet#mention': {
      const did = feature.did;
      if (onMentionClick) {
        return (
          <span
            key={key}
            role="button"
            tabIndex={0}
            className={styles.mentionButton}
            onClick={(e) => {
              e.stopPropagation();
              onMentionClick(did);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onMentionClick(did);
              }
            }}
          >
            {text}
          </span>
        );
      }
      return (
        <span key={key} className={styles.mention}>
          {text}
        </span>
      );
    }
    case 'app.protoimsg.chat.message#link':
    case 'app.bsky.richtext.facet#link':
      if (!isSafeUrl(feature.uri)) {
        return <span key={key}>{text}</span>;
      }
      return (
        <a
          key={key}
          href={feature.uri}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {text}
        </a>
      );
    case 'app.bsky.richtext.facet#tag':
      return (
        <span key={key} className={styles.tag}>
          {text}
        </span>
      );
    default:
      return <span key={key}>{text}</span>;
  }
}

/** Basic structural check — skip facets that would crash the renderer */
function isValidFacet(facet: GenericFacet | RichTextFacet, byteLen: number): boolean {
  const { index, features } = facet;
  if (index.byteStart < 0 || index.byteEnd < 0) return false;
  if (index.byteStart >= index.byteEnd) return false;
  if (index.byteEnd > byteLen) return false;
  if (!Array.isArray(features) || features.length === 0) return false;
  return true;
}

/**
 * Renders text with atproto facets (mentions, links, tags).
 * Uses TextEncoder/TextDecoder for correct UTF-8 byte offset → string conversion.
 * Supports both protoimsg and Bluesky facet shapes.
 */
export function RichText({ text, facets, onMentionClick }: RichTextProps) {
  if (!facets || facets.length === 0) {
    return <>{text}</>;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const decoder = new TextDecoder();

  // Filter out malformed facets, then sort by byte start position
  const sorted = [...facets]
    .filter((f) => isValidFacet(f, bytes.length))
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  const segments: ReactNode[] = [];
  let lastByteEnd = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;

    // Skip overlapping facets
    if (byteStart < lastByteEnd) continue;

    // Text before this facet
    if (byteStart > lastByteEnd) {
      segments.push(decoder.decode(bytes.slice(lastByteEnd, byteStart)));
    }

    const facetText = decoder.decode(bytes.slice(byteStart, byteEnd));
    const feature = facet.features[0] as AnyFeature | undefined;

    if (feature) {
      segments.push(renderFeature(feature, facetText, byteStart, onMentionClick));
    } else {
      segments.push(facetText);
    }

    lastByteEnd = byteEnd;
  }

  // Remaining text after last facet
  if (lastByteEnd < bytes.length) {
    segments.push(decoder.decode(bytes.slice(lastByteEnd)));
  }

  return <>{segments}</>;
}
