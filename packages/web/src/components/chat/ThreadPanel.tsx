import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatThread, type ChatThreadState } from '../../hooks/useChatThread';
import { useBlocks } from '../../contexts/BlockContext';
import { useAuth } from '../../hooks/useAuth';
import { hasMentionOf } from '../../lib/facet-utils';
import { MessageItem } from './MessageItem';
import { MessageInput } from './MessageInput';
import type { MessageView } from '../../types';
import styles from './ThreadPanel.module.css';

interface ThreadPanelProps {
  thread: ChatThreadState;
  channelUri: string;
  liveMessages: MessageView[];
  onClose: () => void;
  onReport?: (messageUri: string, preview: string) => void;
}

export function ThreadPanel({
  thread,
  channelUri,
  liveMessages,
  onClose,
  onReport,
}: ThreadPanelProps) {
  const { t } = useTranslation('chat');
  const { messages, loading, sendReply } = useChatThread(thread, liveMessages);
  const { blockedDids } = useBlocks();
  const { did } = useAuth();

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

  // Auto-scroll to bottom of thread
  const messagesRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 80;

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Scroll to bottom on initial load and when thread changes
  useEffect(() => {
    if (!loading && focusedMessage) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [loading, focusUri, focusedMessage, scrollToBottom]);

  // Scroll to bottom when new replies arrive (if user is near bottom)
  useEffect(() => {
    if (isNearBottomRef.current && directChildren.length > 0) {
      scrollToBottom();
    }
  }, [directChildren.length, scrollToBottom]);

  const onMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, []);

  return (
    <aside className={styles.panel} aria-label={t('threadPanel.ariaLabel')}>
      <header className={styles.header}>
        {isAtRoot ? (
          <button
            className={styles.closeBackBtn}
            onClick={onClose}
            type="button"
            aria-label={t('threadPanel.closeAriaLabel')}
          >
            &larr;
          </button>
        ) : (
          <button
            className={styles.backBtn}
            onClick={handleBack}
            type="button"
            aria-label={t('threadPanel.backAriaLabel')}
          >
            &larr;
          </button>
        )}
        <h2 className={styles.title}>{t('threadPanel.title')}</h2>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          type="button"
          aria-label={t('threadPanel.closeAriaLabel')}
        >
          &times;
        </button>
      </header>
      <div className={styles.messages} ref={messagesRef} onScroll={onMessagesScroll}>
        {loading && <p className={styles.loading}>{t('threadPanel.loading')}</p>}
        {!loading && !focusedMessage && <p className={styles.empty}>{t('threadPanel.notFound')}</p>}
        {focusedMessage && (
          <>
            <div className={styles.rootMessage}>
              <MessageItem
                message={focusedMessage}
                hideActions
                onReport={onReport}
                isMentioned={!!did && hasMentionOf(focusedMessage.facets, did)}
              />
            </div>
            <div className={styles.divider}>
              <span className={styles.replyCountLabel}>
                {t('threadPanel.replyCount', { count: directChildren.length })}
              </span>
            </div>
            {directChildren.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                replyCount={childReplyCounts[msg.uri]}
                onOpenThread={handleDrillInto}
                onReport={onReport}
                isMentioned={!!did && hasMentionOf(msg.facets, did)}
              />
            ))}
          </>
        )}
      </div>
      <MessageInput
        onSend={(text) => {
          void sendReply(text, channelUri, focusUri);
        }}
        onSendWithEmbed={(text, embed) => {
          void sendReply(text, channelUri, focusUri, embed);
        }}
        placeholder={t('threadPanel.inputPlaceholder')}
      />
    </aside>
  );
}
