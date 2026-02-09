import type { AppBskyFeedDefs } from '@atproto/api';
import { useThread } from '../../hooks/useThread';
import { FeedPost } from './FeedPost';
import styles from './ThreadView.module.css';

interface ThreadViewProps {
  uri: string;
  onBack: () => void;
  onNavigateToProfile: (did: string) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  onOpenThread?: (post: AppBskyFeedDefs.PostView) => void;
}

function collectParents(thread: AppBskyFeedDefs.ThreadViewPost): AppBskyFeedDefs.ThreadViewPost[] {
  const parents: AppBskyFeedDefs.ThreadViewPost[] = [];
  let current = thread.parent;
  while (current && '$type' in current && current.$type === 'app.bsky.feed.defs#threadViewPost') {
    const tvp = current as AppBskyFeedDefs.ThreadViewPost;
    parents.unshift(tvp);
    current = tvp.parent;
  }
  return parents;
}

export function ThreadView({
  uri,
  onBack,
  onNavigateToProfile,
  onReply,
  onOpenThread,
}: ThreadViewProps) {
  const { thread, loading, error } = useThread(uri);

  if (loading) {
    return (
      <div className={styles.threadView}>
        <button className={styles.backButton} onClick={onBack}>
          &larr; Back
        </button>
        <div className={styles.loading}>Loading thread...</div>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className={styles.threadView}>
        <button className={styles.backButton} onClick={onBack}>
          &larr; Back
        </button>
        <div className={styles.error}>{error ?? 'Thread not found'}</div>
      </div>
    );
  }

  const parents = collectParents(thread);
  const mainItem: AppBskyFeedDefs.FeedViewPost = {
    post: thread.post,
    $type: 'app.bsky.feed.defs#feedViewPost',
  };

  const replies = (thread.replies ?? []).filter(
    (r): r is AppBskyFeedDefs.ThreadViewPost =>
      '$type' in r && r.$type === 'app.bsky.feed.defs#threadViewPost',
  );

  return (
    <div className={styles.threadView}>
      <button className={styles.backButton} onClick={onBack}>
        &larr; Back
      </button>

      <div className={styles.scrollArea}>
        {parents.map((parent) => {
          const parentItem: AppBskyFeedDefs.FeedViewPost = {
            post: parent.post,
            $type: 'app.bsky.feed.defs#feedViewPost',
          };
          return (
            <div key={parent.post.uri} className={styles.threadParent}>
              <FeedPost
                item={parentItem}
                onNavigateToProfile={onNavigateToProfile}
                onReply={onReply}
                onOpenThread={onOpenThread}
              />
            </div>
          );
        })}

        <div className={styles.threadHighlight}>
          <FeedPost item={mainItem} onNavigateToProfile={onNavigateToProfile} onReply={onReply} />
        </div>

        {replies.map((reply) => {
          const replyItem: AppBskyFeedDefs.FeedViewPost = {
            post: reply.post,
            $type: 'app.bsky.feed.defs#feedViewPost',
          };
          const hasReplies = (reply.post.replyCount ?? 0) > 0;

          return (
            <div key={reply.post.uri} className={styles.replyItem}>
              <FeedPost
                item={replyItem}
                onNavigateToProfile={onNavigateToProfile}
                onReply={onReply}
                onOpenThread={onOpenThread}
              />
              {hasReplies && (
                <button
                  className={styles.viewReplies}
                  onClick={() => {
                    onOpenThread?.(reply.post);
                  }}
                  type="button"
                >
                  View {reply.post.replyCount} {reply.post.replyCount === 1 ? 'reply' : 'replies'}{' '}
                  &rarr;
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
