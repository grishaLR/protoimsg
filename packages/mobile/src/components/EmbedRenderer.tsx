import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

interface EmbedRendererProps {
  embed: unknown;
  colors: ThemeColors;
  isAim: boolean;
}

interface ExternalEmbed {
  $type?: string;
  uri: string;
  title?: string;
  description?: string;
}

function isExternalEmbed(embed: unknown): embed is ExternalEmbed {
  if (!embed || typeof embed !== 'object') return false;
  const e = embed as Record<string, unknown>;
  return typeof e.uri === 'string';
}

function isGifServiceUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return /^(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|[\w-]+\.klipy\.com)$/.test(
      url.hostname,
    );
  } catch {
    return false;
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDomain(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
}

/** Returns true if the embed is a GIF (message text should be hidden) */
export function isGifEmbed(embed: unknown): boolean {
  return isExternalEmbed(embed) && isGifServiceUrl(embed.uri);
}

export function EmbedRenderer({ embed, colors, isAim }: EmbedRendererProps) {
  if (!isExternalEmbed(embed)) return null;

  if (isGifServiceUrl(embed.uri)) {
    return (
      <View style={styles.gifContainer}>
        <Image
          source={{ uri: embed.uri }}
          style={[styles.gif, { borderRadius: isAim ? 0 : radius.sm }]}
          resizeMode="contain"
          accessibilityLabel={embed.description ?? embed.title ?? 'GIF'}
        />
      </View>
    );
  }

  if (!isSafeUrl(embed.uri)) return null;

  return (
    <Pressable
      style={[
        styles.linkCard,
        {
          backgroundColor: colors.base300,
          borderRadius: isAim ? 0 : radius.sm,
          borderColor: colors.borderLight,
        },
      ]}
      onPress={() => void Linking.openURL(embed.uri)}
      accessibilityRole="link"
    >
      <Text style={[styles.linkTitle, { color: colors.baseContent }]} numberOfLines={1}>
        {embed.title ?? getDomain(embed.uri)}
      </Text>
      <Text style={[styles.linkDomain, { color: colors.chromeTextMuted }]} numberOfLines={1}>
        {getDomain(embed.uri)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gifContainer: {
    marginTop: spacing[2],
    maxWidth: 260,
  },
  gif: {
    width: 260,
    height: 200,
  },
  linkCard: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
  },
  linkTitle: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  linkDomain: {
    fontSize: fontSize.xs,
    marginTop: spacing[1],
  },
});
