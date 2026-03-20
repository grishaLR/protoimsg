import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet, Image } from 'react-native';
import { Repeat2, Reply, Play } from 'lucide-react-native';
import { ImageLightbox } from '@/components/ImageLightbox';
import { VideoPlayer } from '@/components/VideoPlayer';
import type {
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
} from '@atproto/api';
import { moderatePost } from '@atproto/api';
import { useRouter } from 'expo-router';
import { useProfile } from '@/services/ProfileContext';
import { useModerationOpts } from '@/services/ModerationContext';
import { Avatar } from '@/components/Avatar';
import { ContentHider } from '@/components/ContentHider';
import { PostControls } from '@/components/PostControls';
import { QuoteEmbed } from '@/components/embeds/QuoteEmbed';
import { useContentTranslation } from '@/hooks/useContentTranslation';
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

interface FeedPostProps {
  item: AppBskyFeedDefs.FeedViewPost;
  /** This post has a self-reply continuation below it */
  hasThreadChild?: boolean;
  /** This post is a self-reply continuation of the post above it */
  hasThreadParent?: boolean;
}

export const FeedPost = React.memo(function FeedPost({
  item,
  hasThreadChild,
  hasThreadParent,
}: FeedPostProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const moderationOpts = useModerationOpts();
  const {
    available: translateAvailable,
    autoTranslate,
    getTranslation,
    requestTranslation,
  } = useContentTranslation();

  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;
  const profile = useProfile(author.did);
  const displayName = author.displayName ?? profile?.displayName ?? author.handle;
  const reason = item.reason;
  const isRepost =
    reason != null &&
    typeof reason === 'object' &&
    '$type' in reason &&
    reason.$type === 'app.bsky.feed.defs#reasonRepost';
  const repostBy = isRepost ? (reason as { by?: { handle?: string } }).by : undefined;

  // Reply context
  const replyParent = item.reply?.parent;
  const replyParentAuthor =
    replyParent && typeof replyParent === 'object' && 'author' in replyParent
      ? (replyParent as { author?: { handle?: string; displayName?: string } }).author
      : undefined;

  // Moderation
  let shouldFilter = false;
  let shouldBlur = false;
  let moderationLabel: string | undefined;

  if (moderationOpts) {
    try {
      const decision = moderatePost(post, moderationOpts);
      const ui = decision.ui('contentList');
      shouldFilter = ui.filter;
      shouldBlur = ui.blur;
      if (ui.alert || ui.inform) {
        moderationLabel = 'Content warning';
      }
    } catch {
      // moderation failure — show content
    }
  }

  if (shouldFilter) return null;

  // Translation
  const translatedText = getTranslation(record.text);
  const handleTranslate = useCallback(() => {
    requestTranslation(record.text);
  }, [record.text, requestTranslation]);

  // Parent text for translation
  const parentText = (item.reply?.parent as { record?: { text?: string } } | undefined)?.record
    ?.text;
  const parentTranslated = parentText ? getTranslation(parentText) : undefined;

  // Auto-translate on mount if enabled
  useEffect(() => {
    if (autoTranslate && translateAvailable) {
      if (record.text && !translatedText) requestTranslation(record.text);
      if (parentText && !parentTranslated) requestTranslation(parentText);
    }
  }, [autoTranslate, translateAvailable, record.text, parentText]);

  const handlePress = useCallback(() => {
    router.push(`/thread/${encodeURIComponent(post.uri)}` as never);
  }, [router, post.uri]);

  // Image lightbox
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Extract embeds — handles plain embeds and recordWithMedia (quote + media combo)
  const embedType = post.embed
    ? ((post.embed as Record<string, unknown>).$type as string | undefined)
    : undefined;

  // For recordWithMedia, the media (images/external) is nested in .media
  const mediaEmbed =
    embedType === 'app.bsky.embed.recordWithMedia#view'
      ? (post.embed as { media?: Record<string, unknown> }).media
      : post.embed;

  const mediaType = mediaEmbed ? (mediaEmbed.$type as string | undefined) : undefined;

  const images =
    mediaType === 'app.bsky.embed.images#view'
      ? (mediaEmbed as AppBskyEmbedImages.View).images
      : [];

  // Video embed
  const videoEmbed =
    mediaType === 'app.bsky.embed.video#view'
      ? (mediaEmbed as {
          thumbnail?: string;
          alt?: string;
          playlist?: string;
          aspectRatio?: { width: number; height: number };
        })
      : undefined;

  const externalEmbedRaw =
    mediaType === 'app.bsky.embed.external#view'
      ? (
          mediaEmbed as {
            external?: { uri?: string; title?: string; description?: string; thumb?: string };
          }
        ).external
      : undefined;

  // Detect GIF embeds and resolve animated URL
  const gifInfo = (() => {
    if (!externalEmbedRaw?.uri) return null;
    try {
      const url = new URL(externalEmbedRaw.uri);
      const host = url.hostname.toLowerCase();

      // Tenor: ext.uri IS the direct media URL
      if (host === 'media.tenor.com') {
        return { animatedUri: externalEmbedRaw.uri, alt: externalEmbedRaw.title };
      }

      // GIPHY: extract ID from page URL, construct direct GIF URL
      if (
        /^(www\.)?giphy\.com$/.test(host) ||
        /^media\d*\.giphy\.com$/.test(host) ||
        host === 'i.giphy.com'
      ) {
        const parts = url.pathname.split('/');
        const last = parts[parts.length - 1];
        if (last) {
          const id = last.includes('-') ? last.split('-').pop() : last;
          if (id) {
            return {
              animatedUri: `https://i.giphy.com/media/${id}/200.gif`,
              alt: externalEmbedRaw.title,
            };
          }
        }
        // Fallback to thumb if we can't parse the ID
        return {
          animatedUri: externalEmbedRaw.thumb ?? externalEmbedRaw.uri,
          alt: externalEmbedRaw.title,
        };
      }

      // Klipy: ext.uri IS the direct CDN URL
      if (host === 'cdn.klipy.com') {
        return { animatedUri: externalEmbedRaw.uri, alt: externalEmbedRaw.title };
      }

      return null;
    } catch {
      return null;
    }
  })();

  const externalEmbed = gifInfo ? undefined : externalEmbedRaw;

  // Quote embed — from record#view or recordWithMedia#view
  const quoteRecord = (() => {
    if (!post.embed) return undefined;
    let recordView: unknown;
    if (embedType === 'app.bsky.embed.record#view') {
      recordView = (post.embed as AppBskyEmbedRecord.View).record;
    } else if (embedType === 'app.bsky.embed.recordWithMedia#view') {
      recordView = (post.embed as { record?: { record?: unknown } }).record?.record;
    }
    if (
      recordView &&
      typeof recordView === 'object' &&
      '$type' in (recordView as Record<string, unknown>) &&
      (recordView as Record<string, unknown>).$type === 'app.bsky.embed.record#viewRecord'
    ) {
      return recordView as AppBskyEmbedRecord.ViewRecord;
    }
    return undefined;
  })();

  return (
    <Pressable
      style={[
        styles.container,
        { borderBottomColor: hasThreadChild ? 'transparent' : colors.base200 },
        hasThreadChild && styles.threadParentContainer,
        hasThreadParent && styles.threadChildContainer,
      ]}
      onPress={handlePress}
    >
      {isRepost && repostBy ? (
        <View style={styles.repostIndicatorRow}>
          <Repeat2 size={12} color={colors.chromeTextMuted} />
          <Text style={[styles.repostIndicator, { color: colors.chromeTextMuted }]}>
            Reposted by @{repostBy.handle}
          </Text>
        </View>
      ) : null}
      {replyParentAuthor &&
      !isRepost &&
      !hasThreadParent &&
      replyParent &&
      '$type' in (replyParent as Record<string, unknown>) ? (
        <Pressable
          style={[styles.parentPreview, { borderBottomColor: 'transparent' }]}
          onPress={() => {
            if ('uri' in replyParent) {
              router.push(
                `/thread/${encodeURIComponent((replyParent as { uri: string }).uri)}` as never,
              );
            }
          }}
        >
          <View style={styles.parentPreviewRow}>
            <View style={styles.parentPreviewAvatarCol}>
              <Avatar
                url={(replyParent as { author?: { avatar?: string } }).author?.avatar}
                name={replyParentAuthor.displayName ?? replyParentAuthor.handle ?? ''}
                size="sm"
              />
              <View style={[styles.threadLineBottom, { backgroundColor: colors.base300 }]} />
            </View>
            <View style={styles.parentPreviewBody}>
              <Text
                style={[styles.parentPreviewName, { color: colors.baseContent }]}
                numberOfLines={1}
              >
                {replyParentAuthor.displayName ?? replyParentAuthor.handle}
              </Text>
              <Text
                style={[styles.parentPreviewText, { color: colors.chromeTextMuted }]}
                numberOfLines={3}
              >
                {parentTranslated ?? parentText ?? ''}
              </Text>
              {/* Parent embed — images or external link card */}
              {(() => {
                const parentEmbed = (replyParent as { embed?: Record<string, unknown> }).embed;
                if (!parentEmbed) return null;
                const pType = parentEmbed.$type as string | undefined;
                // Images
                if (pType === 'app.bsky.embed.images#view') {
                  const pImages = (parentEmbed as AppBskyEmbedImages.View).images;
                  if (pImages.length > 0) {
                    return (
                      <Image
                        source={{ uri: pImages[0].thumb }}
                        style={{
                          width: '100%',
                          height: 120,
                          borderRadius: radius.md,
                          marginTop: spacing[2],
                          backgroundColor: '#e0e0e0',
                        }}
                        resizeMode="cover"
                      />
                    );
                  }
                }
                // External — detect GIFs and use animated URL
                if (pType === 'app.bsky.embed.external#view') {
                  const ext = (
                    parentEmbed as { external?: { uri?: string; thumb?: string; title?: string } }
                  ).external;
                  if (ext?.uri) {
                    // Resolve GIF URL same as main post
                    let gifUrl: string | null = null;
                    try {
                      const h = new URL(ext.uri).hostname.toLowerCase();
                      if (h === 'media.tenor.com' || h === 'cdn.klipy.com') {
                        gifUrl = ext.uri;
                      } else if (
                        /^(www\.)?giphy\.com$/.test(h) ||
                        /^media\d*\.giphy\.com$/.test(h) ||
                        h === 'i.giphy.com'
                      ) {
                        const parts = new URL(ext.uri).pathname.split('/');
                        const last = parts[parts.length - 1];
                        const id = last && last.includes('-') ? last.split('-').pop() : last;
                        if (id) gifUrl = `https://i.giphy.com/media/${id}/200.gif`;
                      }
                    } catch {
                      /* no-op */
                    }

                    if (gifUrl) {
                      return (
                        <View style={{ marginTop: spacing[2], position: 'relative' }}>
                          <Image
                            source={{ uri: gifUrl }}
                            style={{
                              width: '100%',
                              aspectRatio: 16 / 9,
                              borderRadius: radius.md,
                              backgroundColor: '#e0e0e0',
                            }}
                            resizeMode="contain"
                          />
                          <View style={styles.gifBadge}>
                            <Text style={styles.gifBadgeText}>GIF</Text>
                          </View>
                        </View>
                      );
                    }

                    if (ext.thumb) {
                      return (
                        <Image
                          source={{ uri: ext.thumb }}
                          style={{
                            width: '100%',
                            height: 120,
                            borderRadius: radius.md,
                            marginTop: spacing[2],
                            backgroundColor: '#e0e0e0',
                          }}
                          resizeMode="cover"
                        />
                      );
                    }
                  }
                }
                // Video
                if (pType === 'app.bsky.embed.video#view') {
                  const vid = parentEmbed as {
                    thumbnail?: string;
                    playlist?: string;
                    alt?: string;
                  };
                  if (vid.playlist) {
                    return (
                      <View style={{ marginTop: spacing[2] }}>
                        <VideoPlayer
                          playlist={vid.playlist}
                          thumbnail={vid.thumbnail}
                          alt={vid.alt}
                          postUri={post.uri}
                        />
                      </View>
                    );
                  }
                  if (vid.thumbnail) {
                    return (
                      <View style={{ marginTop: spacing[2], position: 'relative' }}>
                        <Image
                          source={{ uri: vid.thumbnail }}
                          style={{
                            width: '100%',
                            height: 150,
                            borderRadius: radius.md,
                            backgroundColor: '#e0e0e0',
                          }}
                          resizeMode="cover"
                        />
                        <View style={styles.playOverlay}>
                          <View style={styles.playButton}>
                            <Play size={20} color="#fff" fill="#fff" />
                          </View>
                        </View>
                      </View>
                    );
                  }
                }
                // recordWithMedia in parent — extract media
                if (pType === 'app.bsky.embed.recordWithMedia#view') {
                  const rwmMedia = (parentEmbed as { media?: Record<string, unknown> }).media;
                  const rwmType = rwmMedia?.$type as string | undefined;
                  if (rwmType === 'app.bsky.embed.video#view') {
                    const vid = rwmMedia as { thumbnail?: string; playlist?: string; alt?: string };
                    if (vid.playlist) {
                      return (
                        <View style={{ marginTop: spacing[2] }}>
                          <VideoPlayer
                            playlist={vid.playlist}
                            thumbnail={vid.thumbnail}
                            alt={vid.alt}
                            postUri={post.uri}
                          />
                        </View>
                      );
                    }
                    if (vid.thumbnail) {
                      return (
                        <Image
                          source={{ uri: vid.thumbnail }}
                          style={{
                            width: '100%',
                            height: 150,
                            borderRadius: radius.md,
                            marginTop: spacing[2],
                            backgroundColor: '#e0e0e0',
                          }}
                          resizeMode="cover"
                        />
                      );
                    }
                  }
                  if (rwmType === 'app.bsky.embed.images#view') {
                    const pImages = (rwmMedia as AppBskyEmbedImages.View).images;
                    if (pImages.length > 0) {
                      return (
                        <Image
                          source={{ uri: pImages[0].thumb }}
                          style={{
                            width: '100%',
                            height: 120,
                            borderRadius: radius.md,
                            marginTop: spacing[2],
                            backgroundColor: '#e0e0e0',
                          }}
                          resizeMode="cover"
                        />
                      );
                    }
                  }
                }
                // Quote embed in parent
                if (pType === 'app.bsky.embed.record#view') {
                  const rec = (parentEmbed as AppBskyEmbedRecord.View).record;
                  if (
                    '$type' in (rec as Record<string, unknown>) &&
                    (rec as Record<string, unknown>).$type === 'app.bsky.embed.record#viewRecord'
                  ) {
                    return <QuoteEmbed record={rec as AppBskyEmbedRecord.ViewRecord} />;
                  }
                }
                return null;
              })()}
            </View>
          </View>
        </Pressable>
      ) : replyParentAuthor && !isRepost && !hasThreadParent ? (
        <Pressable
          style={styles.replyContext}
          onPress={() => {
            if (replyParent && 'uri' in (replyParent as Record<string, unknown>)) {
              router.push(
                `/thread/${encodeURIComponent((replyParent as { uri: string }).uri)}` as never,
              );
            }
          }}
        >
          <View style={styles.replyContextRow}>
            <Reply size={12} color={colors.chromeTextMuted} />
            <Text style={[styles.replyContextText, { color: colors.chromeTextMuted }]}>
              Reply to @{replyParentAuthor.handle ?? replyParentAuthor.displayName}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.row}>
        <View style={styles.avatarColumn}>
          {hasThreadParent ? (
            <View style={[styles.threadLineTop, { backgroundColor: colors.base300 }]} />
          ) : null}
          <Pressable
            onPress={() => {
              router.push(`/profile/${encodeURIComponent(author.did)}` as never);
            }}
          >
            <Avatar url={author.avatar} name={displayName} size="sm" />
          </Pressable>
          {hasThreadChild ? (
            <View style={[styles.threadLineBottom, { backgroundColor: colors.base300 }]} />
          ) : null}
        </View>
        <View style={styles.body}>
          {/* Author line */}
          <Pressable
            style={styles.authorRow}
            onPress={() => {
              router.push(`/profile/${encodeURIComponent(author.did)}` as never);
            }}
          >
            <Text style={[styles.displayName, { color: colors.baseContent }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.handle, { color: colors.chromeTextMuted }]} numberOfLines={1}>
              @{author.handle}
            </Text>
            <Text style={[styles.time, { color: colors.chromeTextMuted }]}>
              · {timeAgo(record.createdAt)}
            </Text>
          </Pressable>

          {/* Post content */}
          <ContentHider blur={shouldBlur} label={moderationLabel}>
            <Text style={[styles.postText, { color: colors.baseContent }]}>
              {translatedText ?? record.text}
            </Text>
            {translatedText ? (
              <Text style={[styles.translatedLabel, { color: colors.chromeTextMuted }]}>
                Translated
              </Text>
            ) : null}

            {/* Image embeds */}
            {images.length > 0 ? (
              <>
                <View style={styles.imageGrid}>
                  {images.slice(0, 4).map((img, i) => (
                    <Pressable
                      key={i}
                      onPress={() => {
                        setLightboxIndex(i);
                      }}
                      style={[images.length > 1 ? styles.imageGridItem : styles.imageSingleItem]}
                    >
                      <Image
                        source={{ uri: img.thumb }}
                        style={{
                          width: '100%',
                          height: images.length === 1 ? 200 : 150,
                          borderRadius: radius.md,
                          backgroundColor: '#e0e0e0',
                        }}
                        resizeMode="cover"
                        accessibilityLabel={img.alt || 'Image'}
                      />
                    </Pressable>
                  ))}
                </View>
                <ImageLightbox
                  images={images.map((img) => ({
                    uri: img.fullsize,
                    alt: img.alt,
                  }))}
                  initialIndex={lightboxIndex >= 0 ? lightboxIndex : 0}
                  visible={lightboxIndex >= 0}
                  onClose={() => {
                    setLightboxIndex(-1);
                  }}
                />
              </>
            ) : null}

            {/* Video embed — inline player */}
            {videoEmbed ? (
              videoEmbed.playlist ? (
                <VideoPlayer
                  playlist={videoEmbed.playlist}
                  thumbnail={videoEmbed.thumbnail}
                  alt={videoEmbed.alt}
                  postUri={post.uri}
                />
              ) : videoEmbed.thumbnail ? (
                <View style={styles.videoContainer}>
                  <Image
                    source={{ uri: videoEmbed.thumbnail }}
                    style={{
                      width: '100%',
                      height: 200,
                      borderRadius: radius.md,
                      backgroundColor: '#e0e0e0',
                    }}
                    resizeMode="cover"
                    accessibilityLabel={videoEmbed.alt || 'Video'}
                  />
                  <View style={styles.playOverlay}>
                    <View style={styles.playButton}>
                      <Play size={20} color="#fff" fill="#fff" />
                    </View>
                  </View>
                </View>
              ) : null
            ) : null}

            {/* GIF embed — tapping opens original URL */}
            {gifInfo ? (
              <Pressable
                style={styles.gifContainer}
                onPress={() => {
                  if (externalEmbedRaw?.uri) void Linking.openURL(externalEmbedRaw.uri);
                }}
              >
                <Image
                  source={{ uri: gifInfo.animatedUri }}
                  style={{
                    width: '100%',
                    aspectRatio: 16 / 9,
                    borderRadius: radius.md,
                    backgroundColor: '#e0e0e0',
                  }}
                  resizeMode="contain"
                  accessibilityLabel={gifInfo.alt || 'GIF'}
                />
                <View style={styles.gifBadge}>
                  <Text style={styles.gifBadgeText}>GIF</Text>
                </View>
              </Pressable>
            ) : null}

            {/* External link card — tapping opens URL in browser */}
            {externalEmbed ? (
              <Pressable
                style={[
                  styles.linkCard,
                  { borderColor: colors.base200, backgroundColor: colors.base100 },
                ]}
                onPress={() => {
                  if (externalEmbed.uri) void Linking.openURL(externalEmbed.uri);
                }}
              >
                {externalEmbed.thumb ? (
                  <Image
                    source={{ uri: externalEmbed.thumb }}
                    style={styles.linkThumb}
                    resizeMode="cover"
                  />
                ) : null}
                <View style={styles.linkMeta}>
                  {externalEmbed.title ? (
                    <Text
                      style={[styles.linkTitle, { color: colors.baseContent }]}
                      numberOfLines={2}
                    >
                      {externalEmbed.title}
                    </Text>
                  ) : null}
                  {externalEmbed.description ? (
                    <Text
                      style={[styles.linkDesc, { color: colors.chromeTextMuted }]}
                      numberOfLines={2}
                    >
                      {externalEmbed.description}
                    </Text>
                  ) : null}
                  {externalEmbed.uri ? (
                    <Text style={[styles.linkDomain, { color: colors.primary }]} numberOfLines={1}>
                      {new URL(externalEmbed.uri).hostname}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ) : null}

            {/* Quote embed */}
            {quoteRecord ? <QuoteEmbed record={quoteRecord} /> : null}

            {/* Unhandled embed — show type for debugging */}
            {!images.length &&
            !externalEmbed &&
            !quoteRecord &&
            !videoEmbed &&
            !gifInfo &&
            mediaType ? (
              <View
                style={[
                  styles.linkCard,
                  { borderColor: colors.base200, backgroundColor: colors.base100 },
                ]}
              >
                <View style={styles.linkMeta}>
                  <Text style={[styles.linkDesc, { color: colors.chromeTextMuted }]}>
                    [{mediaType.split('#')[0]?.split('.').pop() ?? 'embed'}]
                  </Text>
                </View>
              </View>
            ) : null}
          </ContentHider>

          {/* Controls */}
          <PostControls
            post={post}
            onTranslate={handleTranslate}
            showTranslate={translateAvailable && !translatedText && !autoTranslate}
          />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
  },
  repostIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
    paddingLeft: 40,
  },
  repostIndicator: {
    fontSize: fontSize.xs,
  },
  parentPreview: {
    marginBottom: 0,
  },
  parentPreviewRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  parentPreviewAvatarCol: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  parentPreviewBody: {
    flex: 1,
    paddingBottom: spacing[3],
  },
  parentPreviewName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  parentPreviewText: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.4,
  },
  replyContext: {
    paddingLeft: 40,
    marginBottom: spacing[2],
  },
  replyContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  replyContextText: {
    fontSize: fontSize.xs,
  },
  threadChildContainer: {
    paddingTop: 0,
  },
  threadParentContainer: {
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  avatarColumn: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  threadLineTop: {
    width: 2,
    height: spacing[2],
  },
  threadLineBottom: {
    width: 2,
    flexGrow: 1,
    marginBottom: -spacing[4],
  },
  body: {
    flex: 1,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  displayName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    flexShrink: 1,
  },
  handle: {
    fontSize: fontSize.sm,
    flexShrink: 2,
  },
  time: {
    fontSize: fontSize.sm,
  },
  postText: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.5,
  },
  translatedLabel: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    marginTop: spacing[1],
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  gifContainer: {
    marginTop: spacing[3],
    position: 'relative',
  },
  gifBadge: {
    position: 'absolute',
    bottom: spacing[2],
    left: spacing[2],
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  gifBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  videoContainer: {
    marginTop: spacing[3],
    position: 'relative',
  },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 20,
    marginLeft: 3,
  },
  imageSingleItem: {
    width: '100%',
  },
  imageGridItem: {
    width: '48%',
  },
  linkCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginTop: spacing[3],
  },
  linkThumb: {
    width: '100%',
    height: 140,
  },
  linkMeta: {
    padding: spacing[3],
    gap: spacing[1],
  },
  linkTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  linkDesc: {
    fontSize: fontSize.xs,
  },
  linkDomain: {
    fontSize: fontSize.xs,
    marginTop: spacing[1],
  },
});
