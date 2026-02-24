import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AppBskyFeedDefs,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
} from '@atproto/api';
import { MessageCircle, Repeat2, Heart, MoreHorizontal } from 'lucide-react';
import { RichText, type GenericFacet } from '../chat/RichText';
import { isSafeUrl } from '../../lib/sanitize';
import { usePostInteractions } from '../../hooks/usePostInteractions';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { VideoPlayer } from './VideoPlayer';
import { ImageLightbox } from './ImageLightbox';
import styles from './FeedPost.module.css';

interface FeedPostProps {
  item: AppBskyFeedDefs.FeedViewPost;
  onNavigateToProfile?: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  onQuotePost?: (post: AppBskyFeedDefs.PostView) => void;
}

function RelativeTime({ dateStr }: { dateStr: string }) {
  const { t } = useTranslation('feed');
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return <>{t('post.relativeTime.seconds', { count: diffSec })}</>;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return <>{t('post.relativeTime.minutes', { count: diffMin })}</>;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return <>{t('post.relativeTime.hours', { count: diffHr })}</>;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return <>{t('post.relativeTime.days', { count: diffDay })}</>;
  const diffMo = Math.floor(diffDay / 30);
  return <>{t('post.relativeTime.months', { count: diffMo })}</>;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function MediaPills({ type, alt }: { type: string; alt?: string }) {
  const [showAlt, setShowAlt] = useState(false);

  return (
    <>
      <span className={styles.mediaPill} style={{ left: 'var(--cm-space-2)' }}>
        {type}
      </span>
      {alt && (
        <button
          type="button"
          className={styles.mediaPill}
          style={{ right: 'var(--cm-space-2)' }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowAlt((v) => !v);
          }}
        >
          ALT
        </button>
      )}
      {showAlt && alt && (
        <div
          className={styles.altOverlay}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowAlt(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowAlt(false);
            }
          }}
        >
          {alt}
        </div>
      )}
    </>
  );
}

function ImageEmbed({ embed }: { embed: AppBskyEmbedImages.View }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const count = embed.images.length;
  const gridClass =
    count === 1 ? styles.imageGrid1 : count === 2 ? styles.imageGrid2 : styles.imageGrid4;

  return (
    <>
      <div className={`${styles.imageGrid} ${gridClass}`}>
        {embed.images.map((img, i) => (
          <div key={i} className={styles.mediaContainer}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                setLightboxIndex(i);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLightboxIndex(i);
                }
              }}
            >
              <img
                className={styles.embedImage}
                // eslint-disable-next-line no-restricted-syntax -- thumb from ATProto image embed
                src={img.thumb}
                alt={img.alt || ''}
                loading="lazy"
              />
            </div>
            <MediaPills type="IMG" alt={img.alt || undefined} />
          </div>
        ))}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={embed.images}
          initialIndex={lightboxIndex}
          onClose={() => {
            setLightboxIndex(null);
          }}
        />
      )}
    </>
  );
}

function isGiphyUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (
      /^(www\.)?giphy\.com$/.test(url.hostname) ||
      /^media\d*\.giphy\.com$/.test(url.hostname) ||
      url.hostname === 'i.giphy.com'
    );
  } catch {
    return false;
  }
}

function isTenorUrl(uri: string): boolean {
  try {
    return new URL(uri).hostname === 'media.tenor.com';
  } catch {
    return false;
  }
}

function isKlipyUrl(uri: string): boolean {
  try {
    return new URL(uri).hostname === 'cdn.klipy.com';
  } catch {
    return false;
  }
}

/** Extract Giphy ID from page URL and return a direct animated GIF URL */
function getGiphyMediaUrl(pageUri: string): string | null {
  try {
    const url = new URL(pageUri);
    // Page URL format: https://giphy.com/gifs/optional-slug-GIFID
    const parts = url.pathname.split('/');
    const last = parts[parts.length - 1];
    if (!last) return null;
    const id = last.includes('-') ? last.split('-').pop() : last;
    if (!id) return null;
    return `https://i.giphy.com/media/${id}/200.gif`;
  } catch {
    return null;
  }
}

function LinkCardEmbed({ embed }: { embed: AppBskyEmbedExternal.View }) {
  const ext = embed.external;
  if (!isSafeUrl(ext.uri)) return null;

  // Render Giphy links as inline playing GIFs (use direct Giphy CDN, not Bluesky thumbnail which is static)
  const giphyMedia = isGiphyUrl(ext.uri) ? getGiphyMediaUrl(ext.uri) : null;
  if (giphyMedia) {
    const altText =
      ext.description && ext.description !== 'via GIPHY'
        ? ext.description
        : ext.title && ext.title !== 'GIF'
          ? ext.title
          : undefined;
    return (
      <div className={`${styles.gifEmbed} ${styles.mediaContainer}`}>
        {/* eslint-disable-next-line no-restricted-syntax -- constructed from hardcoded https://i.giphy.com prefix */}
        <img src={giphyMedia} alt={ext.title || 'GIF'} className={styles.gifImage} loading="lazy" />
        <MediaPills type="GIF" alt={altText} />
      </div>
    );
  }

  // Render Tenor links as inline playing GIFs (URI is already a direct media URL)
  if (isTenorUrl(ext.uri)) {
    const altText =
      ext.description && ext.description !== 'via GIPHY'
        ? ext.description
        : ext.title && ext.title !== 'GIF'
          ? ext.title
          : undefined;
    return (
      <div className={`${styles.gifEmbed} ${styles.mediaContainer}`}>
        {/* eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() + isTenorUrl() above */}
        <img src={ext.uri} alt={ext.title || 'GIF'} className={styles.gifImage} loading="lazy" />
        <MediaPills type="GIF" alt={altText} />
      </div>
    );
  }

  // Render Klipy links as inline playing GIFs (URI is already a direct CDN URL)
  if (isKlipyUrl(ext.uri)) {
    const altText =
      ext.description && ext.description !== 'via Klipy'
        ? ext.description
        : ext.title && ext.title !== 'GIF'
          ? ext.title
          : undefined;
    return (
      <div className={`${styles.gifEmbed} ${styles.mediaContainer}`}>
        {/* eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() + isKlipyUrl() above */}
        <img src={ext.uri} alt={ext.title || 'GIF'} className={styles.gifImage} loading="lazy" />
        <MediaPills type="GIF" alt={altText} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() at function entry
    <a className={styles.linkCard} href={ext.uri} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line no-restricted-syntax -- thumb from Bluesky API external embed */}
      {ext.thumb && <img className={styles.linkCardThumb} src={ext.thumb} alt="" loading="lazy" />}
      <div className={styles.linkCardBody}>
        <div className={styles.linkCardTitle}>{ext.title}</div>
        {ext.description && <div className={styles.linkCardDesc}>{ext.description}</div>}
        <div className={styles.linkCardDomain}>{getDomain(ext.uri)}</div>
      </div>
    </a>
  );
}

function QuoteEmbed({
  embed,
  onOpenThread,
  onNavigateToProfile,
}: {
  embed: AppBskyEmbedRecord.View;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  onNavigateToProfile?: (did: string) => void;
}) {
  const { t } = useTranslation('feed');
  const record = embed.record;

  // Error states for broken quotes
  if (record.$type === 'app.bsky.embed.record#viewNotFound') {
    return (
      <div className={`${styles.quotePost} ${styles.quoteError}`}>{t('post.quoteDeleted')}</div>
    );
  }
  if (record.$type === 'app.bsky.embed.record#viewBlocked') {
    return (
      <div className={`${styles.quotePost} ${styles.quoteError}`}>{t('post.quoteBlocked')}</div>
    );
  }
  if (record.$type === 'app.bsky.embed.record#viewDetached') {
    return (
      <div className={`${styles.quotePost} ${styles.quoteError}`}>{t('post.quoteDetached')}</div>
    );
  }

  if (record.$type !== 'app.bsky.embed.record#viewRecord') return null;

  const viewRecord = record as AppBskyEmbedRecord.ViewRecord;
  const author = viewRecord.author;
  const value = viewRecord.value as Record<string, unknown>;
  const text = (value.text as string) || '';
  const facets = value.facets as GenericFacet[] | undefined;

  // Build a synthetic PostView so onOpenThread can navigate to the quoted post
  const syntheticPost: AppBskyFeedDefs.PostView = {
    uri: viewRecord.uri,
    cid: viewRecord.cid,
    author: viewRecord.author,
    record: viewRecord.value,
    indexedAt: viewRecord.indexedAt,
    replyCount: viewRecord.replyCount ?? 0,
    repostCount: viewRecord.repostCount ?? 0,
    likeCount: viewRecord.likeCount ?? 0,
    quoteCount: viewRecord.quoteCount ?? 0,
    labels: viewRecord.labels ?? [],
    $type: 'app.bsky.feed.defs#postView',
  };

  // Extract the quoted post's own embeds (images, video, links inside the quoted post)
  const nestedEmbed = viewRecord.embeds?.[0] as
    | AppBskyFeedDefs.FeedViewPost['post']['embed']
    | undefined;

  const handleClick = () => {
    onOpenThread?.(syntheticPost);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={`${styles.quotePost} ${onOpenThread ? styles.quoteClickable : ''}`}
      role={onOpenThread ? 'button' : undefined}
      tabIndex={onOpenThread ? 0 : undefined}
      onClick={onOpenThread ? handleClick : undefined}
      onKeyDown={onOpenThread ? handleKeyDown : undefined}
    >
      <div className={styles.quoteAuthor}>
        {author.avatar && isSafeUrl(author.avatar) && (
          // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
          <img className={styles.quoteAvatar} src={author.avatar} alt="" />
        )}
        <span className={styles.quoteName}>{author.displayName || author.handle}</span>
        <span className={styles.quoteHandle}>@{author.handle}</span>
      </div>
      {text && (
        <div className={styles.quoteText}>
          <RichText text={text} facets={facets} onMentionClick={onNavigateToProfile} />
        </div>
      )}
      {nestedEmbed && (
        <div
          className={styles.quoteMedia}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <PostEmbed embed={nestedEmbed} />
        </div>
      )}
    </div>
  );
}

function VideoEmbed({ embed }: { embed: AppBskyEmbedVideo.View }) {
  return (
    <VideoPlayer
      playlist={embed.playlist}
      thumbnail={embed.thumbnail}
      aspectRatio={embed.aspectRatio}
      alt={embed.alt}
    />
  );
}

function PostEmbed({
  embed,
  onOpenThread,
  onNavigateToProfile,
}: {
  embed: AppBskyFeedDefs.FeedViewPost['post']['embed'];
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  onNavigateToProfile?: (did: string) => void;
}) {
  if (!embed) return null;

  switch (embed.$type) {
    case 'app.bsky.embed.images#view':
      return <ImageEmbed embed={embed as AppBskyEmbedImages.View} />;
    case 'app.bsky.embed.external#view':
      return <LinkCardEmbed embed={embed as AppBskyEmbedExternal.View} />;
    case 'app.bsky.embed.record#view':
      return (
        <QuoteEmbed
          embed={embed as AppBskyEmbedRecord.View}
          onOpenThread={onOpenThread}
          onNavigateToProfile={onNavigateToProfile}
        />
      );
    case 'app.bsky.embed.recordWithMedia#view': {
      const rwm = embed as AppBskyEmbedRecordWithMedia.View;
      return (
        <>
          <PostEmbed embed={rwm.media as AppBskyFeedDefs.FeedViewPost['post']['embed']} />
          <QuoteEmbed
            embed={rwm.record}
            onOpenThread={onOpenThread}
            onNavigateToProfile={onNavigateToProfile}
          />
        </>
      );
    }
    case 'app.bsky.embed.video#view':
      return <VideoEmbed embed={embed as AppBskyEmbedVideo.View} />;
    default:
      return null;
  }
}

/** Extract rkey from an at:// URI */
function extractRkeyFromUri(uri: string): string {
  return uri.split('/').pop() ?? '';
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

export const FeedPost = memo(function FeedPost({
  item,
  onNavigateToProfile,
  onReply,
  onOpenThread,
  onQuotePost,
}: FeedPostProps) {
  const { t } = useTranslation('feed');
  const { post, reason, reply } = item;
  const record = post.record as Record<string, unknown>;
  const text = (record.text as string) || '';
  const facets = record.facets as GenericFacet[] | undefined;

  const isRepost = reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  const isPin = reason?.$type === 'app.bsky.feed.defs#reasonPin';
  const repostAuthor = isRepost ? (reason as AppBskyFeedDefs.ReasonRepost).by : null;

  const { isLiked, isReposted, likeCount, repostCount, replyCount, toggleLike, toggleRepost } =
    usePostInteractions(post);

  const {
    autoTranslate,
    available: translateAvailable,
    targetLang,
    getTranslation,
    isTranslating,
    requestTranslation,
  } = useContentTranslation();
  const [showTranslated, setShowTranslated] = useState(autoTranslate);
  const translatedText = text ? getTranslation(text) : undefined;
  const translating = text ? isTranslating(text) : false;

  // Repost dropdown
  const repostDropdown = useDropdown();

  // More menu dropdown
  const moreDropdown = useDropdown();
  const [linkCopied, setLinkCopied] = useState(false);
  const linkCopiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(linkCopiedTimerRef.current);
    };
  }, []);

  const postUrl = `https://bsky.app/profile/${post.author.handle}/post/${extractRkeyFromUri(post.uri)}`;

  const { setOpen: setMoreOpen } = moreDropdown;
  const handleCopyLink = useCallback(() => {
    void navigator.clipboard.writeText(postUrl).then(() => {
      setLinkCopied(true);
      clearTimeout(linkCopiedTimerRef.current);
      linkCopiedTimerRef.current = setTimeout(() => {
        setLinkCopied(false);
      }, 2000);
    });
    setMoreOpen(false);
  }, [postUrl, setMoreOpen]);

  const goToProfile = useCallback(
    (did: string) => {
      onNavigateToProfile?.(did);
    },
    [onNavigateToProfile],
  );

  const handleBodyClick = useCallback(() => {
    onOpenThread?.(post);
  }, [onOpenThread, post]);

  return (
    <div className={styles.post}>
      {isPin && (
        <div className={styles.pinBar}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 0-.504-2.826L4.456.734Z" />
          </svg>
          {t('post.pinned')}
        </div>
      )}
      {isRepost && repostAuthor && (
        <div className={styles.repostBar}>
          <Repeat2 size={14} /> {t('post.repostedBy')}{' '}
          <span
            className={styles.handle}
            role="button"
            tabIndex={0}
            onClick={() => {
              goToProfile(repostAuthor.did);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(repostAuthor.did);
              }
            }}
          >
            @{repostAuthor.handle}
          </span>
        </div>
      )}

      {reply?.parent && (
        <div className={styles.replyContext}>
          {t('post.replyTo', { handle: (reply.parent as AppBskyFeedDefs.PostView).author.handle })}
        </div>
      )}

      <div className={styles.authorRow}>
        {post.author.avatar && isSafeUrl(post.author.avatar) && (
          <img
            className={styles.avatar}
            // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
            src={post.author.avatar}
            alt=""
            role="button"
            tabIndex={0}
            onClick={() => {
              goToProfile(post.author.did);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToProfile(post.author.did);
              }
            }}
          />
        )}
        <span
          className={styles.displayName}
          role="button"
          tabIndex={0}
          onClick={() => {
            goToProfile(post.author.did);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goToProfile(post.author.did);
            }
          }}
        >
          {post.author.displayName || post.author.handle}
        </span>
        <span
          className={styles.handle}
          role="button"
          tabIndex={0}
          onClick={() => {
            goToProfile(post.author.did);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goToProfile(post.author.did);
            }
          }}
        >
          @{post.author.handle}
        </span>
        <span
          className={`${styles.timestamp} ${onOpenThread ? styles.clickableBody : ''}`}
          role={onOpenThread ? 'button' : undefined}
          tabIndex={onOpenThread ? 0 : undefined}
          onClick={handleBodyClick}
          onKeyDown={
            onOpenThread
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleBodyClick();
                  }
                }
              : undefined
          }
        >
          <RelativeTime dateStr={post.indexedAt} />
        </span>
      </div>

      {text && (
        <div
          className={`${styles.body} ${onOpenThread ? styles.clickableBody : ''}`}
          role={onOpenThread ? 'button' : undefined}
          tabIndex={onOpenThread ? 0 : undefined}
          onClick={handleBodyClick}
          onKeyDown={
            onOpenThread
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleBodyClick();
                  }
                }
              : undefined
          }
          dir="auto"
        >
          {showTranslated && translatedText ? (
            <>
              {translatedText}
              <div className={styles.translationLabel}>
                {t('post.translatedTo', { lang: targetLang })}
                {' \u00B7 '}
                <button
                  type="button"
                  className={styles.showOriginal}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTranslated(false);
                  }}
                >
                  {t('post.showOriginal')}
                </button>
              </div>
            </>
          ) : (
            <RichText text={text} facets={facets} onMentionClick={onNavigateToProfile} />
          )}
        </div>
      )}

      <PostEmbed
        embed={post.embed}
        onOpenThread={onOpenThread}
        onNavigateToProfile={onNavigateToProfile}
      />

      <div className={styles.engagement}>
        <button
          className={styles.engagementButton}
          onClick={() => {
            onReply?.(post);
          }}
          type="button"
        >
          <MessageCircle size={14} /> {replyCount}
        </button>

        {/* Repost dropdown: Repost / Quote Post */}
        <div className={styles.dropdownWrap} ref={repostDropdown.ref}>
          <button
            className={`${styles.engagementButton} ${isReposted ? styles.repostActive : ''}`}
            onClick={() => {
              repostDropdown.setOpen((v) => !v);
            }}
            type="button"
          >
            <Repeat2 size={14} /> {repostCount}
          </button>
          {repostDropdown.open && (
            <div className={styles.dropdown}>
              <button
                className={styles.dropdownItem}
                onClick={() => {
                  toggleRepost();
                  repostDropdown.setOpen(false);
                }}
                type="button"
              >
                <Repeat2 size={14} />
                {t('post.repost')}
              </button>
              <button
                className={styles.dropdownItem}
                onClick={() => {
                  onQuotePost?.(post);
                  repostDropdown.setOpen(false);
                }}
                type="button"
              >
                <MessageCircle size={14} />
                {t('post.quotePost')}
              </button>
            </div>
          )}
        </div>

        <button
          className={`${styles.engagementButton} ${isLiked ? styles.likeActive : ''}`}
          onClick={toggleLike}
          type="button"
        >
          <Heart size={14} fill={isLiked ? 'currentColor' : 'none'} /> {likeCount}
        </button>

        {translateAvailable && text && (
          <button
            className={styles.engagementButton}
            onClick={() => {
              if (translatedText) {
                setShowTranslated((v) => !v);
              } else {
                requestTranslation(text);
                setShowTranslated(true);
              }
            }}
            disabled={translating}
            type="button"
          >
            {translating ? t('post.translating') : t('post.translate')}
          </button>
        )}

        {/* More menu: Copy link, Open in Bluesky */}
        <div className={styles.dropdownWrap} ref={moreDropdown.ref}>
          <button
            className={styles.engagementButton}
            onClick={() => {
              moreDropdown.setOpen((v) => !v);
            }}
            type="button"
            aria-label={t('post.moreActions')}
          >
            <MoreHorizontal size={14} />
          </button>
          {moreDropdown.open && (
            <div className={styles.dropdown}>
              <button className={styles.dropdownItem} onClick={handleCopyLink} type="button">
                {linkCopied ? t('post.linkCopied') : t('post.copyLink')}
              </button>
              <a
                className={styles.dropdownItem}
                // eslint-disable-next-line no-restricted-syntax -- postUrl constructed from safe handle + rkey
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  moreDropdown.setOpen(false);
                }}
              >
                {t('post.openInBluesky')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
