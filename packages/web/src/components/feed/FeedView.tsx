import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useSavedFeeds, DISCOVER_FEED_URI } from '../../hooks/useSavedFeeds';
import { useFeed } from '../../hooks/useFeed';
import { FeedTabBar } from './FeedTabBar';
import { FeedPost } from './FeedPost';
import { FeedComposer } from './FeedComposer';
import styles from './FeedView.module.css';

const SCROLL_BOTTOM_THRESHOLD = 200;
const SCROLL_DOWN_THRESHOLD = 300;
const IDLE_SHOW_DELAY_MS = 8000;

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
  const { feeds } = useSavedFeeds();
  const [activeUri, setActiveUri] = useState<string | undefined>(DISCOVER_FEED_URI);
  const { posts, loading, loadingMore, error, hasMore, loadMore, refresh } = useFeed(activeUri);
  const [showRefresh, setShowRefresh] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handleRefreshClick = useCallback(() => {
    setShowRefresh(false);
    refresh();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [refresh]);

  return (
    <div className={styles.feedView}>
      <FeedComposer replyTo={replyTo ?? null} onClearReply={onClearReply} onPostSuccess={refresh} />

      <FeedTabBar feeds={feeds} activeUri={activeUri} onSelect={setActiveUri} />

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Loading feed...</div>
      ) : posts.length === 0 ? (
        <div className={styles.empty}>No posts to show</div>
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
            {loadingMore && <div className={styles.loadingMore}>Loading more...</div>}
          </div>

          {showRefresh && (
            <button className={styles.refreshFooter} onClick={handleRefreshClick}>
              &#x2191; Refresh feed
            </button>
          )}
        </>
      )}
    </div>
  );
}
