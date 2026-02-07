import type { RichTextFacet, MentionFeature, LinkFeature } from '@chatmosphere/lexicon';
import type { ReactNode } from 'react';

interface RichTextProps {
  text: string;
  facets?: RichTextFacet[];
}

function renderFeature(
  feature: MentionFeature | LinkFeature,
  text: string,
  key: number,
): ReactNode {
  switch (feature.$type) {
    case 'app.chatmosphere.chat.message#mention':
      return (
        <span key={key} style={{ color: '#0066cc', fontWeight: 600 }}>
          {text}
        </span>
      );
    case 'app.chatmosphere.chat.message#link':
      return (
        <a
          key={key}
          href={feature.uri}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#0066cc' }}
        >
          {text}
        </a>
      );
  }
}

/**
 * Renders text with ATProto facets (mentions and links).
 * Uses TextEncoder/TextDecoder for correct UTF-8 byte offset → string conversion.
 */
export function RichText({ text, facets }: RichTextProps) {
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
    const feature = facet.features[0];

    if (feature) {
      segments.push(renderFeature(feature, facetText, byteStart));
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
