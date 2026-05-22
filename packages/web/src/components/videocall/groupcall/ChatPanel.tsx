import { memo, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { ChatMessage } from './types';
import styles from '../VideoCallOverlay.module.css';

interface ChatPanelProps {
  messages: ChatMessage[];
  /** LiveKit identity of the local participant — used to label own messages. */
  localIdentity: string;
  onSend: (text: string) => void;
}

/** Side chat panel. Owns its own input state so typing never re-renders the call. */
export const ChatPanel = memo(function ChatPanel({
  messages,
  localIdentity,
  onSend,
}: ChatPanelProps) {
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = () => {
    const text = chatInput.trim();
    if (!text) return;
    onSend(text);
    setChatInput('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 220,
        borderLeft: '1px solid var(--cm-chrome-hover)',
        background: 'var(--cm-titlebar)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 8px',
          fontSize: 'var(--cm-text-sm)',
        }}
      >
        {messages.length === 0 && (
          <p style={{ opacity: 0.4, textAlign: 'center', padding: 8 }}>No messages yet</p>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 2, wordBreak: 'break-word' }}>
            <strong style={{ color: 'var(--color-primary)', marginRight: 4 }}>
              {m.sender === localIdentity ? 'You' : m.senderName}:
            </strong>
            <span style={{ color: 'var(--cm-chrome-text)' }}>{m.text}</span>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '4px 8px',
          borderTop: '1px solid var(--cm-chrome-hover)',
        }}
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => {
            setChatInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="Message..."
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--cm-chrome-hover)',
            background: 'var(--cm-surface-button)',
            color: 'var(--cm-chrome-text)',
            fontSize: 'var(--cm-text-sm)',
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button className={styles.controlBtn} onClick={send} style={{ width: 28, height: 28 }}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
});
