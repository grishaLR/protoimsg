import type { RichTextFacet, MentionFeature, LinkFeature } from '@chatmosphere/lexicon';
import type { ReactNode } from 'react';
import { isSafeUrl } from '../../lib/sanitize';

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

/** Facet shape shared by both Chatmosphere and Bluesky records */
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
    case 'app.chatmosphere.chat.message#mention':
    case 'app.bsky.richtext.facet#mention': {
      const did = feature.did;
      if (onMentionClick) {
        return (
          <span
            key={key}
            role="button"
            tabIndex={0}
            style={{ color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}
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
        <span key={key} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
          {text}
        </span>
      );
    }
    case 'app.chatmosphere.chat.message#link':
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
          style={{ color: 'var(--color-primary)' }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {text}
        </a>
      );
    case 'app.bsky.richtext.facet#tag':
      return (
        <span key={key} style={{ color: 'var(--color-primary)' }}>
          {text}
        </span>
      );
    default:
      return <span key={key}>{text}</span>;
  }
}

/**
 * Renders text with ATProto facets (mentions, links, tags).
 * Uses TextEncoder/TextDecoder for correct UTF-8 byte offset → string conversion.
 * Supports both Chatmosphere and Bluesky facet shapes.
 */
export function RichText({ text, facets, onMentionClick }: RichTextProps) {
  if (!facets || facets.length === 0) {
    return <>{text}</>;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const decoder = new TextDecoder();

  // Sort facets by byte start position
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);

  const segments: ReactNode[] = [];
  let lastByteEnd = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;

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
