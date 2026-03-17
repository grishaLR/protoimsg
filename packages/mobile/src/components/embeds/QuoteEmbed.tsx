import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Play } from 'lucide-react-native';
import type { AppBskyEmbedRecord, AppBskyFeedPost, AppBskyEmbedImages } from '@atproto/api';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface QuoteEmbedProps {
  record: AppBskyEmbedRecord.ViewRecord;
}

export const QuoteEmbed = React.memo(function QuoteEmbed({ record }: QuoteEmbedProps) {
  const { colors } = useTheme();
  const router = useRouter();

  const author = record.author;
  const value = record.value as AppBskyFeedPost.Record;

  const displayName = author.displayName ?? author.handle;

  // Check for embeds inside the quoted post
  const embeds = record.embeds ?? [];
  const imageEmbed = embeds.find(
    (e) =>
      typeof e === 'object' &&
      '$type' in (e as Record<string, unknown>) &&
      (e as Record<string, unknown>).$type === 'app.bsky.embed.images#view',
  ) as AppBskyEmbedImages.View | undefined;
  const images = imageEmbed?.images ?? [];

  // Check for video embeds
  const videoEmbed = embeds.find(
    (e) =>
      typeof e === 'object' &&
      '$type' in (e as Record<string, unknown>) &&
      (e as Record<string, unknown>).$type === 'app.bsky.embed.video#view',
  ) as { thumbnail?: string } | undefined;

  // Check for recordWithMedia (video or images nested in media)
  const rwmEmbed = embeds.find(
    (e) =>
      typeof e === 'object' &&
      '$type' in (e as Record<string, unknown>) &&
      (e as Record<string, unknown>).$type === 'app.bsky.embed.recordWithMedia#view',
  ) as { media?: Record<string, unknown> } | undefined;
  const rwmMedia = rwmEmbed?.media;
  const rwmVideoThumb =
    rwmMedia && rwmMedia.$type === 'app.bsky.embed.video#view'
      ? (rwmMedia as { thumbnail?: string }).thumbnail
      : undefined;

  const videoThumb = videoEmbed?.thumbnail ?? rwmVideoThumb;

  return (
    <Pressable
      style={[styles.container, { borderColor: colors.base200, backgroundColor: colors.base100 }]}
      onPress={() => {
        router.push(`/thread/${encodeURIComponent(record.uri)}` as never);
      }}
    >
      <View style={styles.authorRow}>
        <Avatar url={author.avatar} name={displayName} size="sm" />
        <Text style={[styles.displayName, { color: colors.baseContent }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.handle, { color: colors.chromeTextMuted }]} numberOfLines={1}>
          @{author.handle}
        </Text>
        {value.createdAt ? (
          <Text style={[styles.time, { color: colors.chromeTextMuted }]}>
            · {timeAgo(value.createdAt)}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.text, { color: colors.baseContent }]} numberOfLines={4}>
        {value.text}
      </Text>
      {videoThumb ? (
        <View style={styles.videoThumbContainer}>
          <Image
            source={{ uri: videoThumb }}
            style={[styles.videoThumb, { borderRadius: radius.sm }]}
            resizeMode="cover"
          />
          <View style={styles.playOverlay}>
            <View style={styles.playBtn}>
              <Play size={16} color="#fff" fill="#fff" />
            </View>
          </View>
        </View>
      ) : images.length > 0 ? (
        <View style={styles.imageRow}>
          {images.slice(0, 2).map((img, i) => (
            <Image
              key={i}
              source={{ uri: img.thumb }}
              style={[styles.thumb, { borderRadius: radius.sm }]}
              accessibilityLabel={img.alt || 'Image'}
            />
          ))}
          {images.length > 2 ? (
            <Text style={[styles.moreImages, { color: colors.chromeTextMuted }]}>
              +{images.length - 2}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[3],
    gap: spacing[2],
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  displayName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
  handle: {
    fontSize: fontSize.xs,
    flexShrink: 2,
  },
  time: {
    fontSize: fontSize.xs,
  },
  text: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.4,
  },
  videoThumbContainer: {
    position: 'relative',
    marginTop: spacing[1],
  },
  videoThumb: {
    width: '100%',
    height: 120,
    backgroundColor: '#e0e0e0',
  },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 2,
  },
  imageRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'center',
  },
  thumb: {
    width: 60,
    height: 60,
    backgroundColor: '#e0e0e0',
  },
  moreImages: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
