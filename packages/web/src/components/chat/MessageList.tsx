import { useEffect, useRef } from 'react';
import { MessageItem } from './MessageItem';
import type { MessageView } from '../../types';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: MessageView[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className={styles.container}>
      {loading && <p className={styles.loading}>Loading messages...</p>}
      {!loading && messages.length === 0 && (
        <p className={styles.empty}>No messages yet. Start the conversation!</p>
      )}
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
