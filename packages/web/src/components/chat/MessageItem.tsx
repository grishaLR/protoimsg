import { useState, memo } from 'react';
import type { MessageView } from '../../types';
import { useModeration } from '../../hooks/useModeration';
import { RichText } from './RichText';
import { UserIdentity } from './UserIdentity';
import styles from './MessageItem.module.css';

interface MessageItemProps {
  message: MessageView;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  const moderation = useModeration(message.did);
  const [revealed, setRevealed] = useState(false);

  if (moderation.shouldFilter) return null;

  const blurred = moderation.shouldBlur && !revealed;

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
    </div>
  );
});
