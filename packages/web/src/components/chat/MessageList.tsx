import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualList } from 'virtualized-ui';
import { MessageItem } from './MessageItem';
import { PollCard } from './PollCard';
import { UserIdentity } from './UserIdentity';
import { hasMentionOf } from '../../lib/facet-utils';
import { useAuth } from '../../hooks/useAuth';
import type { MessageView, PollView, TimelineItem } from '../../types';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: MessageView[];
  polls?: PollView[];
  loading: boolean;
  typingUsers?: string[];
  /** Reply counts keyed by root message URI */
  replyCounts?: Record<string, number>;
  /** Called when user clicks Reply or reply count — opens thread sidebar */
  onOpenThread?: (rootUri: string) => void;
  /** Called when user clicks Report on a message */
  onReport?: (messageUri: string, preview: string) => void;
  /** Called when user votes on a poll */
  onVote?: (pollId: string, pollUri: string, selectedOptions: number[]) => void;
}

const SCROLL_THRESHOLD = 80;

export function MessageList({
  messages,
  polls = [],
  loading,
  typingUsers = [],
  replyCounts,
  onOpenThread,
  onReport,
  onVote,
}: MessageListProps) {
  const { t } = useTranslation('chat');
  const { did } = useAuth();
  const isNearBottomRef = useRef(true);

  // Merge messages + polls into a single timeline sorted by created_at
  const timeline = useMemo(() => {
    // Main timeline only shows root messages (not replies)
    const rootMessages: TimelineItem[] = messages
      .filter((m) => !m.reply_root)
      .map((m) => ({ ...m, _type: 'message' as const }));

    const pollItems: TimelineItem[] = polls.map((p) => ({ ...p, _type: 'poll' as const }));

    return [...rootMessages, ...pollItems].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages, polls]);

  const { virtualItems, totalSize, containerRef, measureElement, handleScroll, data } =
    useVirtualList({
      data: timeline,
      getItemId: (item) => item.id,
      estimatedItemHeight: 40,
    });

  const scrollToBottom = useCallback(() => {
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [containerRef]);

  const onScroll = useCallback(() => {
    handleScroll();
    const el = containerRef.current;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, [handleScroll, containerRef]);

  // Scroll to bottom on initial load
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && !loading && timeline.length > 0) {
      didInitialScroll.current = true;
      // Wait a frame for virtualizer to measure
      requestAnimationFrame(scrollToBottom);
    }
  }, [loading, timeline.length, scrollToBottom]);

  // Scroll to bottom when new messages arrive (if user is near bottom)
  useEffect(() => {
    if (isNearBottomRef.current && timeline.length > 0) {
      scrollToBottom();
    }
  }, [timeline.length, scrollToBottom]);

  return (
    <div className={styles.container} ref={containerRef} onScroll={onScroll}>
      {loading && <p className={styles.loading}>{t('messageList.loading')}</p>}
      {!loading && timeline.length === 0 && (
        <p className={styles.empty}>{t('messageList.empty')}</p>
      )}
      <div className={styles.spacer} style={{ height: totalSize }}>
        {virtualItems.map((vi) => {
          const item = data[vi.index] as TimelineItem;
          return (
            <div
              key={vi.key}
              ref={measureElement}
              data-index={vi.index}
              className={styles.virtualItem}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {item._type === 'poll' ? (
                <PollCard poll={item} onVote={onVote ?? (() => {})} />
              ) : (
                <MessageItem
                  message={item}
                  replyCount={replyCounts?.[item.uri]}
                  onOpenThread={onOpenThread}
                  onReport={onReport}
                  isMentioned={!!did && hasMentionOf(item.facets, did)}
                />
              )}
            </div>
          );
        })}
      </div>
      {typingUsers.length > 0 && (
        <div className={styles.typing} role="status" aria-live="polite">
          {typingUsers.length === 1 && typingUsers[0] ? (
            <>
              <UserIdentity did={typingUsers[0]} size="sm" /> {t('messageList.typing.one')}
            </>
          ) : typingUsers.length === 2 && typingUsers[0] && typingUsers[1] ? (
            <>
              <UserIdentity did={typingUsers[0]} size="sm" /> {t('messageList.typing.twoAnd')}{' '}
              <UserIdentity did={typingUsers[1]} size="sm" /> {t('messageList.typing.twoSuffix')}
            </>
          ) : (
            <>{t('messageList.typing.many', { count: typingUsers.length })}</>
          )}
        </div>
      )}
    </div>
  );
}
