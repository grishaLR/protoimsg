import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LIMITS } from '@protoimsg/shared';
import type { MessageView } from '../../types';
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
            Replying to <UserIdentity did={replyTo.did} size="sm" />
          </span>
          <button
            className={styles.replyCancelBtn}
            onClick={onCancelReply}
            type="button"
            aria-label="Cancel reply"
          >
            &times;
          </button>
        </div>
      )}
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
            (replyTo
              ? 'Reply... (Enter to send, Esc to cancel)'
              : 'Type a message... (Enter to send, Shift+Enter for newline)')
          }
          rows={2}
          aria-label={replyTo ? 'Type a reply' : 'Type a message'}
        />
        <button className={styles.sendButton} onClick={send} disabled={!text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
