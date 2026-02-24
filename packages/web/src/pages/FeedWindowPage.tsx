import { useState, useCallback } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { FeedView } from '../components/feed/FeedView';
import { ProfileView } from '../components/feed/ProfileView';
import { ThreadView } from '../components/feed/ThreadView';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './FeedWindowPage.module.css';

type View = 'feed' | 'profile' | 'thread';

type NavEntry =
  | { type: 'feed' }
  | { type: 'profile'; did: string }
  | { type: 'thread'; uri: string };

/**
 * Standalone feed page for Tauri desktop window.
 * Route: /feed
 */
export function FeedWindowPage() {
  const [view, setView] = useState<View>('feed');
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [quoteTo, setQuoteTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  const threadUri =
    view === 'thread'
      ? ((navHistory[navHistory.length - 1] as { uri: string } | undefined)?.uri ?? null)
      : null;
  const profileTarget =
    view === 'profile'
      ? ((navHistory[navHistory.length - 1] as { did: string } | undefined)?.did ?? null)
      : null;

  const goBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length <= 1) {
        setView('feed');
        return [];
      }
      const next = prev.slice(0, -1);
      const target = next[next.length - 1];
      if (target) setView(target.type);
      return next;
    });
  }, []);

  const navigateToProfile = useCallback(
    (did: string) => {
      setNavHistory((prev) => {
        if (view !== 'profile' && view !== 'thread') {
          return [{ type: view }, { type: 'profile', did }];
        }
        return [...prev, { type: 'profile', did }];
      });
      setView('profile');
    },
    [view],
  );

  const openThread = useCallback(
    (post: AppBskyFeedDefs.PostView) => {
      setNavHistory((prev) => {
        if (view !== 'profile' && view !== 'thread') {
          return [{ type: view }, { type: 'thread', uri: post.uri }];
        }
        return [...prev, { type: 'thread', uri: post.uri }];
      });
      setView('thread');
    },
    [view],
  );

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
    setView('feed');
  }, []);

  const clearReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handleQuotePost = useCallback((post: AppBskyFeedDefs.PostView) => {
    setQuoteTo(post);
    setView('feed');
  }, []);

  const clearQuote = useCallback(() => {
    setQuoteTo(null);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header} data-tauri-drag-region="">
        <span className={styles.headerTitle}>Feed</span>
        <WindowControls />
      </div>
      <div className={styles.body}>
        {view === 'feed' && (
          <FeedView
            onNavigateToProfile={navigateToProfile}
            onReply={handleReply}
            onOpenThread={openThread}
            onQuotePost={handleQuotePost}
            replyTo={replyTo}
            quoteTo={quoteTo}
            onClearReply={clearReply}
            onClearQuote={clearQuote}
          />
        )}
        {view === 'profile' && profileTarget && (
          <ProfileView
            actor={profileTarget}
            onBack={goBack}
            onNavigateToProfile={navigateToProfile}
            onReply={handleReply}
            onOpenThread={openThread}
            onQuotePost={handleQuotePost}
          />
        )}
        {view === 'thread' && threadUri && (
          <ThreadView
            uri={threadUri}
            onBack={goBack}
            onNavigateToProfile={navigateToProfile}
            onReply={handleReply}
            onOpenThread={openThread}
            onQuotePost={handleQuotePost}
          />
        )}
      </div>
    </div>
  );
}
