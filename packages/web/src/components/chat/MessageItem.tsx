import { useState, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageView } from '../../types';
import { useModeration } from '../../hooks/useModeration';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { RichText, type GenericFacet } from './RichText';
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
  /** Whether this message mentions the current user */
  isMentioned?: boolean;
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
  isMentioned,
}: MessageItemProps) {
  const { t } = useTranslation('chat');
  const moderation = useModeration(message.did);
  const [revealed, setRevealed] = useState(false);

  const {
    autoTranslate,
    available: translateAvailable,
    targetLang,
    getTranslation,
    isTranslating: isTranslatingText,
    requestTranslation,
  } = useContentTranslation();
  const [showTranslated, setShowTranslated] = useState(autoTranslate);
  const translatedText = message.text ? getTranslation(message.text) : undefined;
  const translating = message.text ? isTranslatingText(message.text) : false;

  const handleOpenThread = useCallback(() => {
    onOpenThread?.(message.uri);
  }, [onOpenThread, message.uri]);

  if (moderation.shouldFilter) return null;

  const blurred = moderation.shouldBlur && !revealed;
  const hasReplies = (replyCount ?? 0) > 0;
  const showReplyActions = !hideActions && !!onOpenThread;
  const showTranslateBtn = translateAvailable && !!message.text;

  return (
    <div
      className={`${styles.item} ${message.pending ? styles.pending : ''} ${isMentioned ? styles.mentioned : ''}`}
    >
      <span className={styles.meta}>
        <span className={styles.did}>
          <UserIdentity did={message.did} showAvatar />
        </span>
        <span className={styles.time}>{formatTime(message.created_at)}</span>
      </span>
      {blurred ? (
        <span className={styles.blurredText}>
          {t('messageItem.contentWarning')}{' '}
          <button
            className={styles.revealBtn}
            onClick={() => {
              setRevealed(true);
            }}
          >
            {t('messageItem.clickToReveal')}
          </button>
        </span>
      ) : (
        <span className={styles.text} dir="auto">
          {showTranslated && translatedText ? (
            <>
              {translatedText}
              <span className={styles.translationLabel}>
                {t('messageItem.translatedTo', { lang: targetLang })}
                {' \u00B7 '}
                <button
                  type="button"
                  className={styles.showOriginal}
                  onClick={() => {
                    setShowTranslated(false);
                  }}
                >
                  {t('messageItem.showOriginal')}
                </button>
              </span>
            </>
          ) : (
            <RichText text={message.text} facets={message.facets as GenericFacet[]} />
          )}
        </span>
      )}
      {(showReplyActions || showTranslateBtn) && (
        <div className={styles.actions}>
          {showReplyActions && hasReplies && (
            <button className={styles.threadBtn} onClick={handleOpenThread} type="button">
              {t('messageItem.replyCount', { count: replyCount })}
            </button>
          )}
          {showReplyActions && (
            <button className={styles.replyBtn} onClick={handleOpenThread} type="button">
              {t('messageItem.replyButton')}
            </button>
          )}
          {showTranslateBtn && (
            <button
              className={styles.translateBtn}
              onClick={() => {
                if (translatedText) {
                  setShowTranslated((v) => !v);
                } else {
                  requestTranslation(message.text);
                  setShowTranslated(true);
                }
              }}
              disabled={translating}
              type="button"
            >
              {translating ? t('messageItem.translating') : t('messageItem.translate')}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
