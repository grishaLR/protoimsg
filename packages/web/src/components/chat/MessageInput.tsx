import { useState, type KeyboardEvent } from 'react';
import { LIMITS } from '@chatmosphere/shared';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  onSend: (text: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
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

  return (
    <div className={styles.container}>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          setText(e.target.value.slice(0, LIMITS.maxMessageLength));
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        rows={2}
      />
      <button className={styles.sendButton} onClick={send} disabled={!text.trim()}>
        Send
      </button>
    </div>
  );
}
