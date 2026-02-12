import { useState, memo, useCallback } from 'react';
import type { MessageView } from '../../types';
import { useModeration } from '../../hooks/useModeration';
import { RichText } from './RichText';
import { UserIdentity } from './UserIdentity';
import styles from './MessageItem.module.css';

interface MessageItemProps {
  message: MessageView;
  /** Number of replies this message has */
  replyCount?: number;
  /** Called when user clicks Reply or the reply count badge — opens the thread sidebar */
  onOpenThread?: (rootUri: string) => void;
  /** Whether to hide the reply/thread actions (e.g. inside thread panel) */
  hideActions?: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const MessageItem = memo(function MessageItem({
  message,
  replyCount,
  onOpenThread,
  hideActions,
}: MessageItemProps) {
  const moderation = useModeration(message.did);
  const [revealed, setRevealed] = useState(false);

  const handleOpenThread = useCallback(() => {
    onOpenThread?.(message.uri);
  }, [onOpenThread, message.uri]);

  if (moderation.shouldFilter) return null;

  const blurred = moderation.shouldBlur && !revealed;
  const hasReplies = (replyCount ?? 0) > 0;

  return (
    <div className={`${styles.item} ${message.pending ? styles.pending : ''}`}>
      <span className={styles.meta}>
        <span className={styles.did}>
          <UserIdentity did={message.did} showAvatar />
        </span>
        <span className={styles.time}>{formatTime(message.created_at)}</span>
      </span>
      {blurred ? (
        <span className={styles.blurredText}>
          Content warning{' '}
          <button
            className={styles.revealBtn}
            onClick={() => {
              setRevealed(true);
            }}
          >
            Click to reveal
          </button>
        </span>
      ) : (
        <span className={styles.text}>
          <RichText text={message.text} />
        </span>
      )}
      {!hideActions && onOpenThread && (
        <div className={styles.actions}>
          {hasReplies && (
            <button className={styles.threadBtn} onClick={handleOpenThread} type="button">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
          <button className={styles.replyBtn} onClick={handleOpenThread} type="button">
            Reply
          </button>
        </div>
      )}
    </div>
  );
});
