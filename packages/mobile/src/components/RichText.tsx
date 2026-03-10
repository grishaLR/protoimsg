import React from 'react';
import { Text, Linking, StyleSheet } from 'react-native';
import type { ThemeColors } from '@/theme';
import { fontSize } from '@/theme/tokens';

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{
    $type: string;
    uri?: string;
    did?: string;
    tag?: string;
  }>;
}

interface RichTextProps {
  text: string;
  facets?: Facet[];
  colors: ThemeColors;
  onMentionPress?: (did: string) => void;
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Renders AT Protocol rich text with facet highlighting.
 * Supports mentions, links, and tags.
 */
export const RichText = React.memo(function RichText({
  text,
  facets,
  colors,
  onMentionPress,
}: RichTextProps) {
  if (!facets || facets.length === 0) {
    return <Text style={[styles.text, { color: colors.baseContent }]}>{text}</Text>;
  }

  const bytes = encoder.encode(text);

  // Sort facets by byte start, filter out invalid ones
  const sorted = [...facets]
    .filter(
      (f) =>
        f.index.byteStart >= 0 &&
        f.index.byteEnd <= bytes.length &&
        f.index.byteStart < f.index.byteEnd,
    )
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < cursor) continue; // skip overlapping

    // Plain text before this facet
    if (byteStart > cursor) {
      parts.push(
        <Text key={`plain-${cursor}`} style={{ color: colors.baseContent }}>
          {decoder.decode(bytes.slice(cursor, byteStart))}
        </Text>,
      );
    }

    const facetText = decoder.decode(bytes.slice(byteStart, byteEnd));
    const feature = facet.features[0];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
    if (!feature) {
      parts.push(
        <Text key={`unknown-${byteStart}`} style={{ color: colors.baseContent }}>
          {facetText}
        </Text>,
      );
    } else if (
      feature.$type === 'app.bsky.richtext.facet#mention' ||
      feature.$type === 'app.protoimsg.richtext.facet#mention'
    ) {
      const did = feature.did;
      parts.push(
        <Text
          key={`mention-${byteStart}`}
          style={[styles.mention, { color: colors.primary }]}
          onPress={
            did && onMentionPress
              ? () => {
                  onMentionPress(did);
                }
              : undefined
          }
        >
          {facetText}
        </Text>,
      );
    } else if (
      feature.$type === 'app.bsky.richtext.facet#link' ||
      feature.$type === 'app.protoimsg.richtext.facet#link'
    ) {
      const uri = feature.uri;
      const safeUri = uri && isSafeUrl(uri) ? uri : undefined;
      parts.push(
        <Text
          key={`link-${byteStart}`}
          style={[styles.link, { color: colors.primary }]}
          onPress={safeUri ? () => void Linking.openURL(safeUri) : undefined}
        >
          {facetText}
        </Text>,
      );
    } else if (
      feature.$type === 'app.bsky.richtext.facet#tag' ||
      feature.$type === 'app.protoimsg.richtext.facet#tag'
    ) {
      parts.push(
        <Text key={`tag-${byteStart}`} style={[styles.tag, { color: colors.primary }]}>
          {facetText}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={`other-${byteStart}`} style={{ color: colors.baseContent }}>
          {facetText}
        </Text>,
      );
    }

    cursor = byteEnd;
  }

  // Remaining plain text
  if (cursor < bytes.length) {
    parts.push(
      <Text key={`tail-${cursor}`} style={{ color: colors.baseContent }}>
        {decoder.decode(bytes.slice(cursor))}
      </Text>,
    );
  }

  return <Text style={styles.text}>{parts}</Text>;
});

const styles = StyleSheet.create({
  text: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.4,
  },
  mention: {
    fontWeight: '600',
  },
  link: {
    textDecorationLine: 'underline',
  },
  tag: {
    fontWeight: '500',
  },
});
