import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualList } from 'virtualized-ui';
import type { DmMessageView } from '../../types';
import { RichText } from '../chat/RichText';
import styles from './DmMessageList.module.css';

interface DmMessageListProps {
  messages: DmMessageView[];
  currentDid: string;
  typing: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const SCROLL_THRESHOLD = 60;

export function DmMessageList({ messages, currentDid, typing }: DmMessageListProps) {
  const { t } = useTranslation('dm');
  const isNearBottomRef = useRef(true);

  const {
    virtualItems,
    totalSize,
    containerRef,
    measureElement,
    handleScroll,
    scrollToIndex,
    data,
  } = useVirtualList({
    data: messages,
    getItemId: (msg) => msg.id,
    estimatedItemHeight: 40,
    gap: 4,
  });

  const onScroll = useCallback(() => {
    handleScroll();
    const el = containerRef.current;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, [handleScroll, containerRef]);

  useEffect(() => {
    if (isNearBottomRef.current && messages.length > 0) {
      scrollToIndex(messages.length - 1);
    }
  }, [messages.length, scrollToIndex]);

  if (messages.length === 0 && !typing) {
    return (
      <div className={styles.empty} role="status">
        {t('messageList.empty')}
      </div>
    );
  }

  return (
    <div className={styles.messageList} ref={containerRef} onScroll={onScroll}>
      <div className={styles.spacer} style={{ height: totalSize }}>
        {virtualItems.map((vi) => {
          const msg = data[vi.index] as DmMessageView;
          const isOwn = msg.senderDid === currentDid;
          return (
            <div
              key={vi.key}
              ref={measureElement}
              data-index={vi.index}
              className={styles.virtualItem}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <div
                className={`${styles.message} ${isOwn ? styles.own : styles.other} ${msg.pending ? styles.pending : ''}`}
              >
                <div className={styles.bubble} dir="auto">
                  <RichText text={msg.text} />
                </div>
                <span className={styles.time}>{formatTime(msg.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {typing && (
        <div className={styles.typingIndicator} role="status" aria-live="polite">
          {t('messageList.typing')}
        </div>
      )}
    </div>
  );
}
