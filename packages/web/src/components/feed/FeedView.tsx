import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useSavedFeeds, DISCOVER_FEED_URI } from '../../hooks/useSavedFeeds';
import { useFeed } from '../../hooks/useFeed';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { FeedTabBar } from './FeedTabBar';
import { FeedPost } from './FeedPost';
import { FeedComposer } from './FeedComposer';
import styles from './FeedView.module.css';

const SCROLL_BOTTOM_THRESHOLD = 200;
const SCROLL_DOWN_THRESHOLD = 300;
const IDLE_SHOW_DELAY_MS = 8000;

/** Module-level cache: feed URI → scrollTop. Survives component unmount/remount. */
const scrollPositionCache = new Map<string, number>();

interface FeedViewProps {
  onNavigateToProfile?: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  replyTo?: AppBskyFeedDefs.PostView | null;
  onClearReply?: () => void;
}

export function FeedView({
  onNavigateToProfile,
  onReply,
  onOpenThread,
  replyTo,
  onClearReply,
}: FeedViewProps) {
  const { t } = useTranslation('feed');
  const { feeds } = useSavedFeeds();
  const [activeUri, setActiveUri] = useState<string | undefined>(DISCOVER_FEED_URI);
  const { posts, loading, loadingMore, error, hasMore, loadMore, refresh } = useFeed(activeUri);
  const { autoTranslate, requestBatchTranslation, available } = useContentTranslation();
  const [showRefresh, setShowRefresh] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTranslatedCount = useRef(0);

  // Start idle timer once posts load
  useEffect(() => {
    if (posts.length === 0) {
      setShowRefresh(false);
      return;
    }

    idleTimerRef.current = setTimeout(() => {
      setShowRefresh(true);
    }, IDLE_SHOW_DELAY_MS);

    return () => {
      clearTimeout(idleTimerRef.current);
    };
  }, [posts.length]);

  // Reset translation tracking when switching feeds
  useEffect(() => {
    lastTranslatedCount.current = 0;
  }, [activeUri]);

  // Auto-translate new posts when pages load
  useEffect(() => {
    if (!autoTranslate || !available || posts.length === 0) return;
    if (posts.length === lastTranslatedCount.current) return;

    const newPosts = posts.slice(lastTranslatedCount.current);
    const texts = newPosts
      .map((item) => ((item.post.record as Record<string, unknown>).text as string) || '')
      .filter(Boolean);

    lastTranslatedCount.current = posts.length;
    if (texts.length > 0) requestBatchTranslation(texts);
  }, [posts.length, autoTranslate, available, posts, requestBatchTranslation]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Show refresh footer when scrolled down
    if (el.scrollTop > SCROLL_DOWN_THRESHOLD) {
      setShowRefresh(true);
      clearTimeout(idleTimerRef.current);
    } else {
      setShowRefresh(false);
    }

    // Load more when near bottom
    if (
      hasMore &&
      !loadingMore &&
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
    ) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  // Restore scroll position when feed changes or component remounts
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeUri) return;
    const saved = scrollPositionCache.get(activeUri);
    if (saved) {
      el.scrollTop = saved;
    }
  }, [activeUri, posts.length]); // posts.length ensures DOM is populated before restore

  // Save scroll position on unmount or feed change
  useEffect(() => {
    const currentUri = activeUri;
    return () => {
      const el = scrollRef.current;
      if (el && currentUri) {
        scrollPositionCache.set(currentUri, el.scrollTop);
      }
    };
  }, [activeUri]);

  const handleRefreshClick = useCallback(() => {
    setShowRefresh(false);
    refresh();
    scrollRef.current?.scrollTo({ top: 0 });
    if (activeUri) scrollPositionCache.delete(activeUri);
  }, [refresh, activeUri]);

  return (
    <div className={styles.feedView}>
      <FeedComposer replyTo={replyTo ?? null} onClearReply={onClearReply} onPostSuccess={refresh} />

      <FeedTabBar feeds={feeds} activeUri={activeUri} onSelect={setActiveUri} />

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>{t('feedView.loading')}</div>
      ) : posts.length === 0 ? (
        <div className={styles.empty}>{t('feedView.empty')}</div>
      ) : (
        <>
          <div className={styles.container} ref={scrollRef} onScroll={onScroll}>
            {posts.map((item, index) => {
              const isRepost = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
              const reposterDid = isRepost
                ? (item.reason as AppBskyFeedDefs.ReasonRepost).by.did
                : '';
              const key = `${item.post.uri}-${reposterDid || 'orig'}-${index}`;
              return (
                <FeedPost
                  key={key}
                  item={item}
                  onNavigateToProfile={onNavigateToProfile}
                  onReply={onReply}
                  onOpenThread={onOpenThread}
                />
              );
            })}
            {loadingMore && <div className={styles.loadingMore}>{t('feedView.loadingMore')}</div>}
          </div>

          {showRefresh && (
            <button className={styles.refreshFooter} onClick={handleRefreshClick}>
              &#x2191; {t('feedView.refresh')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
