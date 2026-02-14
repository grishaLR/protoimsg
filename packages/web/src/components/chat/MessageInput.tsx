import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LIMITS } from '@protoimsg/shared';
import type { MessageView } from '../../types';
import { FormattingToolbar } from './FormattingToolbar';
import { UserIdentity } from './UserIdentity';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  onTyping?: () => void;
  /** When set, the input is in "reply to" mode */
  replyTo?: MessageView | null;
  /** Called when user cancels the reply */
  onCancelReply?: () => void;
  /** Placeholder override */
  placeholder?: string;
}

export function MessageInput({
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
  placeholder,
}: MessageInputProps) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when replyTo changes (user clicked Reply)
  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape' && replyTo) {
      onCancelReply?.();
    }
  }

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  function handleChange(value: string) {
    setText(value.slice(0, LIMITS.maxMessageLength));
    if (value.length > 0) onTyping?.();
  }

  return (
    <div className={styles.container}>
      {replyTo && (
        <div className={styles.replyBar}>
          <span className={styles.replyContext}>
            {t('messageInput.replyingTo')} <UserIdentity did={replyTo.did} size="sm" />
          </span>
          <button
            className={styles.replyCancelBtn}
            onClick={onCancelReply}
            type="button"
            aria-label={t('messageInput.cancelReply.ariaLabel')}
          >
            &times;
          </button>
        </div>
      )}
      <FormattingToolbar textareaRef={textareaRef} onTextChange={handleChange} />
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={text}
          onChange={(e) => {
            handleChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ??
            (replyTo ? t('messageInput.placeholder.reply') : t('messageInput.placeholder.default'))
          }
          rows={2}
          aria-label={
            replyTo ? t('messageInput.ariaLabel.reply') : t('messageInput.ariaLabel.default')
          }
        />
        <button className={styles.sendButton} onClick={send} disabled={!text.trim()}>
          {t('messageInput.send')}
        </button>
      </div>
    </div>
  );
}
