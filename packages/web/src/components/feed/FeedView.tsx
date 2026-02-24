import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useVirtualList } from 'virtualized-ui';
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
const TRANSLATE_DEBOUNCE_MS = 300;
const TRANSLATE_BATCH_SIZE = 3;

interface FeedViewProps {
  onNavigateToProfile?: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
  replyTo?: AppBskyFeedDefs.PostView | null;
  quoteTo?: AppBskyFeedDefs.PostView | null;
  onClearReply?: () => void;
  onClearQuote?: () => void;
  onQuotePost?: (post: AppBskyFeedDefs.PostView) => void;
}

export function FeedView({
  onNavigateToProfile,
  onReply,
  onOpenThread,
  replyTo,
  quoteTo,
  onClearReply,
  onClearQuote,
  onQuotePost,
}: FeedViewProps) {
  const { t } = useTranslation('feed');
  const { feeds } = useSavedFeeds();
  const [activeUri, setActiveUri] = useState<string | undefined>(DISCOVER_FEED_URI);
  const { posts, loading, loadingMore, error, hasMore, loadMore, refresh } = useFeed(activeUri);
  const { autoTranslate, requestBatchTranslation, available } = useContentTranslation();
  const [showRefresh, setShowRefresh] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const translateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const {
    virtualItems,
    totalSize,
    containerRef,
    measureElement,
    handleScroll: virtualizerScroll,
    scrollToTop,
    data,
  } = useVirtualList({
    data: posts,
    getItemId: (item) => {
      const isRepost = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
      const reposterDid = isRepost ? (item.reason as AppBskyFeedDefs.ReasonRepost).by.did : '';
      return `${item.post.cid}-${reposterDid || 'orig'}`;
    },
    estimatedItemHeight: 150,
  });

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

  // Debounced viewport translation — visible posts first, then nearby prefetch.
  // Batches queue sequentially via TranslationContext to avoid overwhelming NLLB.
  useEffect(() => {
    if (!autoTranslate || !available || virtualItems.length === 0) return;

    const first = virtualItems[0];
    const last = virtualItems[virtualItems.length - 1];
    if (!first || !last) return;

    // Debounce: reset timer on each scroll tick, flush after settling
    clearTimeout(translateTimerRef.current);
    translateTimerRef.current = setTimeout(() => {
      const seen = new Set<string>();

      // Visible posts first — these are what the user is looking at
      const visibleTexts: string[] = [];
      for (const vi of virtualItems) {
        const post = data[vi.index];
        if (!post) continue;
        const text = ((post.post.record as Record<string, unknown>).text as string) || '';
        if (text && !seen.has(text)) {
          seen.add(text);
          visibleTexts.push(text);
        }
      }

      // Nearby posts for prefetch — translated after visible ones
      const prefetchTexts: string[] = [];
      const firstVisible = first.index;
      const lastVisible = last.index;
      const prefetchStart = Math.max(0, firstVisible - 5);
      const prefetchEnd = Math.min(posts.length - 1, lastVisible + 5);
      for (let i = prefetchStart; i <= prefetchEnd; i++) {
        if (i < firstVisible || i > lastVisible) {
          const p = posts[i];
          if (!p) continue;
          const text = ((p.post.record as Record<string, unknown>).text as string) || '';
          if (text && !seen.has(text)) {
            seen.add(text);
            prefetchTexts.push(text);
          }
        }
      }

      // Send visible texts first, then prefetch — each batch queues sequentially
      for (let i = 0; i < visibleTexts.length; i += TRANSLATE_BATCH_SIZE) {
        requestBatchTranslation(visibleTexts.slice(i, i + TRANSLATE_BATCH_SIZE));
      }
      for (let i = 0; i < prefetchTexts.length; i += TRANSLATE_BATCH_SIZE) {
        requestBatchTranslation(prefetchTexts.slice(i, i + TRANSLATE_BATCH_SIZE));
      }
    }, TRANSLATE_DEBOUNCE_MS);

    return () => {
      clearTimeout(translateTimerRef.current);
    };
  }, [virtualItems, autoTranslate, available, data, posts, requestBatchTranslation]);

  const onScroll = useCallback(() => {
    virtualizerScroll();
    const el = containerRef.current;

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
  }, [virtualizerScroll, containerRef, hasMore, loadingMore, loadMore]);

  // Scroll to top when switching feeds
  const prevUriRef = useRef(activeUri);
  useEffect(() => {
    if (activeUri !== prevUriRef.current) {
      prevUriRef.current = activeUri;
      scrollToTop();
    }
  }, [activeUri, scrollToTop]);

  const handleRefreshClick = useCallback(() => {
    setShowRefresh(false);
    refresh();
    scrollToTop();
  }, [refresh, scrollToTop]);

  return (
    <div className={styles.feedView}>
      <FeedComposer
        replyTo={replyTo ?? null}
        quoteTo={quoteTo ?? null}
        onClearReply={onClearReply}
        onClearQuote={onClearQuote}
        onPostSuccess={refresh}
      />

      <FeedTabBar feeds={feeds} activeUri={activeUri} onSelect={setActiveUri} />

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>{t('feedView.loading')}</div>
      ) : posts.length === 0 ? (
        <div className={styles.empty}>{t('feedView.empty')}</div>
      ) : (
        <>
          <div className={styles.container} ref={containerRef} onScroll={onScroll}>
            <div className={styles.spacer} style={{ height: totalSize }}>
              {virtualItems.map((vi) => {
                const item = data[vi.index];
                if (!item) return null;
                const isRepost = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
                const reposterDid = isRepost
                  ? (item.reason as AppBskyFeedDefs.ReasonRepost).by.did
                  : '';
                return (
                  <div
                    key={`${item.post.cid}-${reposterDid || 'orig'}`}
                    ref={measureElement}
                    data-index={vi.index}
                    className={styles.virtualItem}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <FeedPost
                      item={item}
                      onNavigateToProfile={onNavigateToProfile}
                      onReply={onReply}
                      onOpenThread={onOpenThread}
                      onQuotePost={onQuotePost}
                    />
                  </div>
                );
              })}
            </div>
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
