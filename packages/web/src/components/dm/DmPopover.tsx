import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DmConversation } from '../../contexts/DmContext';
import { UserIdentity } from '../chat/UserIdentity';
import { DmMessageList } from './DmMessageList';
import { DmInput } from './DmInput';
import styles from './DmPopover.module.css';

interface DmPopoverProps {
  conversation: DmConversation;
  currentDid: string;
  onClose: () => void;
  onToggleMinimize: () => void;
  onSend: (text: string) => void;
  onTyping: () => void;
  onTogglePersist: (persist: boolean) => void;
}

export function DmPopover({
  conversation,
  currentDid,
  onClose,
  onToggleMinimize,
  onSend,
  onTyping,
  onTogglePersist,
}: DmPopoverProps) {
  const { t } = useTranslation('dm');
  const { recipientDid, messages, persist, minimized, typing, unreadCount } = conversation;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // H7: Focus the input when popover expands
  useEffect(() => {
    if (!minimized) {
      // Slight delay to let DOM paint
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [minimized]);

  const displayUnread = unreadCount > 99 ? t('popover.unreadOverflow') : String(unreadCount);

  return (
    <div
      className={`${styles.popover} ${minimized ? styles.minimized : ''}`}
      role="log"
      aria-label={t('popover.ariaLabel', { recipientDid })}
    >
      <div
        className={styles.header}
        onClick={onToggleMinimize}
        role="button"
        tabIndex={0}
        aria-expanded={!minimized}
        aria-label={
          minimized
            ? t('popover.header.ariaLabel.expand', { recipientDid })
            : t('popover.header.ariaLabel.minimize', { recipientDid })
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleMinimize();
          }
        }}
      >
        <span className={styles.headerIdentity}>
          <UserIdentity did={recipientDid} showAvatar size="sm" />
        </span>
        {minimized && unreadCount > 0 && (
          <span
            className={styles.unreadBadge}
            aria-label={t('popover.unreadAriaLabel', { count: unreadCount })}
          >
            {displayUnread}
          </span>
        )}
        <div className={styles.headerActions}>
          <button
            className={`${styles.persistBtn} ${persist ? styles.persistActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePersist(!persist);
            }}
            title={persist ? t('popover.persist.titleActive') : t('popover.persist.titleInactive')}
            aria-label={
              persist
                ? t('popover.persist.ariaLabel.disable')
                : t('popover.persist.ariaLabel.enable')
            }
            aria-pressed={persist}
          >
            {persist ? '\uD83D\uDCBE' : '\u2601\uFE0F'}
          </button>
          <button
            className={styles.headerBtn}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize();
            }}
            title={
              minimized ? t('popover.minimize.titleExpand') : t('popover.minimize.titleMinimize')
            }
            aria-label={
              minimized
                ? t('popover.minimize.ariaLabel.expand')
                : t('popover.minimize.ariaLabel.minimize')
            }
          >
            {minimized ? '\u25B2' : '\u2013'}
          </button>
          <button
            className={styles.headerBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t('popover.close.title')}
            aria-label={t('popover.close.ariaLabel')}
          >
            {'\u2715'}
          </button>
        </div>
      </div>

      {/* L4/M3: Use CSS class instead of unmounting to preserve draft text and scroll */}
      <div className={minimized ? `${styles.body} ${styles.bodyHidden}` : styles.body}>
        <DmMessageList messages={messages} currentDid={currentDid} typing={typing} />
        <DmInput onSend={onSend} onTyping={onTyping} ref={inputRef} />
      </div>
    </div>
  );
}
