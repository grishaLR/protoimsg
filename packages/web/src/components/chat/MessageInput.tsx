import { useState, type KeyboardEvent } from 'react';
import { LIMITS } from '@protoimsg/shared';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  onTyping?: () => void;
}

export function MessageInput({ onSend, onTyping }: MessageInputProps) {
  const [text, setText] = useState('');

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
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
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        rows={2}
        aria-label="Type a message"
      />
      <button className={styles.sendButton} onClick={send} disabled={!text.trim()}>
        Send
      </button>
    </div>
  );
}
