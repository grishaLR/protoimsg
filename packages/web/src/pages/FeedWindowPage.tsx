import { useState, useCallback } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { FeedView } from '../components/feed/FeedView';
import { ProfileView } from '../components/feed/ProfileView';
import { ThreadView } from '../components/feed/ThreadView';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './FeedWindowPage.module.css';

type View = 'feed' | 'profile' | 'thread';

/**
 * Standalone feed page for Tauri desktop window.
 * Route: /feed
 */
export function FeedWindowPage() {
  const [view, setView] = useState<View>('feed');
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [threadStack, setThreadStack] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  const threadUri = threadStack.length > 0 ? (threadStack[threadStack.length - 1] ?? null) : null;

  const navigateToProfile = useCallback((did: string) => {
    setProfileTarget(did);
    setView('profile');
  }, []);

  const backFromProfile = useCallback(() => {
    setView('feed');
    setProfileTarget(null);
  }, []);

  const openThread = useCallback(
    (post: AppBskyFeedDefs.PostView) => {
      if (view === 'thread') {
        setThreadStack((prev) => [...prev, post.uri]);
      } else {
        setThreadStack([post.uri]);
        setView('thread');
      }
    },
    [view],
  );

  const backFromThread = useCallback(() => {
    if (threadStack.length > 1) {
      setThreadStack((prev) => prev.slice(0, -1));
    } else {
      setView('feed');
      setThreadStack([]);
    }
  }, [threadStack.length]);

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
    setView('feed');
  }, []);

  const clearReply = useCallback(() => {
    setReplyTo(null);
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
            replyTo={replyTo}
            onClearReply={clearReply}
          />
        )}
        {view === 'profile' && profileTarget && (
          <ProfileView
            actor={profileTarget}
            onBack={backFromProfile}
            onNavigateToProfile={navigateToProfile}
            onReply={handleReply}
            onOpenThread={openThread}
          />
        )}
        {view === 'thread' && threadUri && (
          <ThreadView
            uri={threadUri}
            onBack={backFromThread}
            onNavigateToProfile={navigateToProfile}
            onReply={handleReply}
            onOpenThread={openThread}
          />
        )}
      </div>
    </div>
  );
}
