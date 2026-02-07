import type { MessageView } from '../../types';
import { RichText } from './RichText';
import styles from './MessageItem.module.css';

interface MessageItemProps {
  message: MessageView;
}

function truncateDid(did: string): string {
  if (did.length <= 24) return did;
  return did.slice(0, 16) + '...' + did.slice(-6);
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function MessageItem({ message }: MessageItemProps) {
  return (
    <div className={`${styles.item} ${message.pending ? styles.pending : ''}`}>
      <span className={styles.meta}>
        <span className={styles.did}>{truncateDid(message.did)}</span>
        <span className={styles.time}>{formatTime(message.created_at)}</span>
      </span>
      <span className={styles.text}>
        <RichText text={message.text} />
      </span>
    </div>
  );
}
