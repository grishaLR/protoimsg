import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatThread, type ChatThreadState } from '../../hooks/useChatThread';
import { useBlocks } from '../../contexts/BlockContext';
import { MessageItem } from './MessageItem';
import { MessageInput } from './MessageInput';
import type { MessageView } from '../../types';
import styles from './ThreadPanel.module.css';

interface ThreadPanelProps {
  thread: ChatThreadState;
  roomUri: string;
  liveMessages: MessageView[];
  onClose: () => void;
}

export function ThreadPanel({ thread, roomUri, liveMessages, onClose }: ThreadPanelProps) {
  const { messages, loading, sendReply } = useChatThread(thread, liveMessages);
  const { blockedDids } = useBlocks();

  // Navigation stack — allows drilling into reply-to-reply threads.
  // The last entry is the currently focused message URI.
  // When empty, we're at the thread root.
  const [focusStack, setFocusStack] = useState<string[]>([]);

  // Reset navigation when a different thread is opened
  useEffect(() => {
    setFocusStack([]);
  }, [thread.rootUri]);

  const focusUri = focusStack.length > 0 ? focusStack[focusStack.length - 1] : thread.rootUri;

  const filteredMessages = useMemo(
    () => messages.filter((m) => !blockedDids.has(m.did)),
    [messages, blockedDids],
  );

  // The focused message (shown at top of panel)
  const focusedMessage = useMemo(
    () => filteredMessages.find((m) => m.uri === focusUri),
    [filteredMessages, focusUri],
  );

  // Direct children of the focused message
  const directChildren = useMemo(
    () => filteredMessages.filter((m) => m.reply_parent === focusUri),
    [filteredMessages, focusUri],
  );

  // Count sub-replies for each direct child (single pass)
  const childReplyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of filteredMessages) {
      if (m.reply_parent) {
        counts[m.reply_parent] = (counts[m.reply_parent] ?? 0) + 1;
      }
    }
    return counts;
  }, [filteredMessages]);

  const handleDrillInto = useCallback((childUri: string) => {
    setFocusStack((prev) => [...prev, childUri]);
  }, []);

  const handleBack = useCallback(() => {
    setFocusStack((prev) => prev.slice(0, -1));
  }, []);

  const isAtRoot = focusStack.length === 0;

  return (
    <aside className={styles.panel} aria-label="Thread">
      <header className={styles.header}>
        {!isAtRoot && (
          <button
            className={styles.backBtn}
            onClick={handleBack}
            type="button"
            aria-label="Back to parent"
          >
            &larr;
          </button>
        )}
        <h2 className={styles.title}>Thread</h2>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          type="button"
          aria-label="Close thread"
        >
          &times;
        </button>
      </header>
      <div className={styles.messages}>
        {loading && <p className={styles.loading}>Loading thread...</p>}
        {!loading && !focusedMessage && <p className={styles.empty}>Thread not found</p>}
        {focusedMessage && (
          <>
            <div className={styles.rootMessage}>
              <MessageItem message={focusedMessage} hideActions />
            </div>
            <div className={styles.divider}>
              <span className={styles.replyCountLabel}>
                {directChildren.length} {directChildren.length === 1 ? 'reply' : 'replies'}
              </span>
            </div>
            {directChildren.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                replyCount={childReplyCounts[msg.uri]}
                onOpenThread={handleDrillInto}
              />
            ))}
          </>
        )}
      </div>
      <MessageInput
        onSend={(text) => {
          void sendReply(text, roomUri, focusUri);
        }}
        placeholder="Reply in thread..."
      />
    </aside>
  );
}
