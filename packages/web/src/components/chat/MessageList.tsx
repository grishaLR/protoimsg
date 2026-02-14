import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualList } from 'virtualized-ui';
import { MessageItem } from './MessageItem';
import { UserIdentity } from './UserIdentity';
import { hasMentionOf } from '../../lib/facet-utils';
import { useAuth } from '../../hooks/useAuth';
import type { MessageView } from '../../types';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: MessageView[];
  loading: boolean;
  typingUsers?: string[];
  /** Reply counts keyed by root message URI */
  replyCounts?: Record<string, number>;
  /** Called when user clicks Reply or reply count — opens thread sidebar */
  onOpenThread?: (rootUri: string) => void;
}

const SCROLL_THRESHOLD = 80;

export function MessageList({
  messages,
  loading,
  typingUsers = [],
  replyCounts,
  onOpenThread,
}: MessageListProps) {
  const { t } = useTranslation('chat');
  const { did } = useAuth();
  const isNearBottomRef = useRef(true);

  // Main timeline only shows root messages (not replies)
  const rootMessages = useMemo(() => messages.filter((m) => !m.reply_root), [messages]);

  const {
    virtualItems,
    totalSize,
    containerRef,
    measureElement,
    handleScroll,
    scrollToIndex,
    data,
  } = useVirtualList({
    data: rootMessages,
    getItemId: (msg) => msg.id,
    estimatedItemHeight: 40,
  });

  const onScroll = useCallback(() => {
    handleScroll();
    const el = containerRef.current;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, [handleScroll, containerRef]);

  useEffect(() => {
    if (isNearBottomRef.current && rootMessages.length > 0) {
      scrollToIndex(rootMessages.length - 1);
    }
  }, [rootMessages.length, scrollToIndex]);

  return (
    <div className={styles.container} ref={containerRef} onScroll={onScroll}>
      {loading && <p className={styles.loading}>{t('messageList.loading')}</p>}
      {!loading && rootMessages.length === 0 && (
        <p className={styles.empty}>{t('messageList.empty')}</p>
      )}
      <div className={styles.spacer} style={{ height: totalSize }}>
        {virtualItems.map((vi) => (
          <div
            key={vi.key}
            ref={measureElement}
            data-index={vi.index}
            className={styles.virtualItem}
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            <MessageItem
              message={data[vi.index] as MessageView}
              replyCount={replyCounts?.[(data[vi.index] as MessageView).uri]}
              onOpenThread={onOpenThread}
              isMentioned={!!did && hasMentionOf((data[vi.index] as MessageView).facets, did)}
            />
          </div>
        ))}
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
