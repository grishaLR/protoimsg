import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AppBskyFeedDefs,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
} from '@atproto/api';
import { RichText, type GenericFacet } from '../chat/RichText';
import { isSafeUrl } from '../../lib/sanitize';
import { usePostInteractions } from '../../hooks/usePostInteractions';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { VideoPlayer } from './VideoPlayer';
import styles from './FeedPost.module.css';

interface FeedPostProps {
  item: AppBskyFeedDefs.FeedViewPost;
  onNavigateToProfile?: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
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

function ImageEmbed({ embed }: { embed: AppBskyEmbedImages.View }) {
  const count = embed.images.length;
  const gridClass =
    count === 1 ? styles.imageGrid1 : count === 2 ? styles.imageGrid2 : styles.imageGrid4;

  return (
    <div className={`${styles.imageGrid} ${gridClass}`}>
      {embed.images.map((img, i) => (
        <a key={i} href={img.fullsize} target="_blank" rel="noopener noreferrer">
          <img className={styles.embedImage} src={img.thumb} alt={img.alt || ''} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

function LinkCardEmbed({ embed }: { embed: AppBskyEmbedExternal.View }) {
  const ext = embed.external;
  if (!isSafeUrl(ext.uri)) return null;

  return (
    <a className={styles.linkCard} href={ext.uri} target="_blank" rel="noopener noreferrer">
      {ext.thumb && <img className={styles.linkCardThumb} src={ext.thumb} alt="" loading="lazy" />}
      <div className={styles.linkCardBody}>
        <div className={styles.linkCardTitle}>{ext.title}</div>
        {ext.description && <div className={styles.linkCardDesc}>{ext.description}</div>}
        <div className={styles.linkCardDomain}>{getDomain(ext.uri)}</div>
      </div>
    </a>
  );
}

function QuoteEmbed({ embed }: { embed: AppBskyEmbedRecord.View }) {
  const record = embed.record;
  if (record.$type !== 'app.bsky.embed.record#viewRecord') return null;

  const viewRecord = record as AppBskyEmbedRecord.ViewRecord;
  const author = viewRecord.author;
  const value = viewRecord.value as Record<string, unknown>;
  const text = (value.text as string) || '';

  return (
    <div className={styles.quotePost}>
      <div className={styles.quoteAuthor}>
        {author.avatar && <img className={styles.quoteAvatar} src={author.avatar} alt="" />}
        <span className={styles.quoteName}>{author.displayName || author.handle}</span>
        <span className={styles.quoteHandle}>@{author.handle}</span>
      </div>
      {text && <div className={styles.quoteText}>{text}</div>}
    </div>
  );
}

function VideoEmbed({ embed }: { embed: AppBskyEmbedVideo.View }) {
  return <VideoPlayer playlist={embed.playlist} thumbnail={embed.thumbnail} />;
}

function PostEmbed({ embed }: { embed: AppBskyFeedDefs.FeedViewPost['post']['embed'] }) {
  if (!embed) return null;

  switch (embed.$type) {
    case 'app.bsky.embed.images#view':
      return <ImageEmbed embed={embed as AppBskyEmbedImages.View} />;
    case 'app.bsky.embed.external#view':
      return <LinkCardEmbed embed={embed as AppBskyEmbedExternal.View} />;
    case 'app.bsky.embed.record#view':
      return <QuoteEmbed embed={embed as AppBskyEmbedRecord.View} />;
    case 'app.bsky.embed.recordWithMedia#view': {
      const rwm = embed as AppBskyEmbedRecordWithMedia.View;
      return (
        <>
          <PostEmbed embed={rwm.media as AppBskyFeedDefs.FeedViewPost['post']['embed']} />
          <QuoteEmbed embed={rwm.record} />
        </>
      );
    }
    case 'app.bsky.embed.video#view':
      return <VideoEmbed embed={embed as AppBskyEmbedVideo.View} />;
    default:
      return null;
  }
}

export const FeedPost = memo(function FeedPost({
  item,
  onNavigateToProfile,
  onReply,
  onOpenThread,
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

  const goToProfile = (did: string) => {
    onNavigateToProfile?.(did);
  };

  const handleBodyClick = () => {
    onOpenThread?.(post);
  };

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
          {'\u21BB'} {t('post.repostedBy')}{' '}
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
        {post.author.avatar && (
          <img
            className={styles.avatar}
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

      <PostEmbed embed={post.embed} />

      <div className={styles.engagement}>
        <button
          className={styles.engagementButton}
          onClick={() => {
            onReply?.(post);
          }}
          type="button"
        >
          &#x1F4AC; {replyCount}
        </button>
        <button
          className={`${styles.engagementButton} ${isReposted ? styles.repostActive : ''}`}
          onClick={toggleRepost}
          type="button"
        >
          &#x21BB; {repostCount}
        </button>
        <button
          className={`${styles.engagementButton} ${isLiked ? styles.likeActive : ''}`}
          onClick={toggleLike}
          type="button"
        >
          {isLiked ? '\u2665' : '\u2661'} {likeCount}
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
      </div>
    </div>
  );
});
