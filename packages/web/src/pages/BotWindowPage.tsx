import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BOT } from '@protoimsg/shared';
import { useBotDm, type BotDmMessage } from '../contexts/BotDmContext';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './BotWindowPage.module.css';

/**
 * Standalone full-window protobuddy chat for Tauri desktop windows.
 * Route: /bot
 */
export function BotWindowPage() {
  const { t } = useTranslation('bot');
  const { messages, openBotDm, closeBotDm, sendMessage } = useBotDm();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    openBotDm();
    return () => {
      closeBotDm();
    };
  }, [openBotDm, closeBotDm]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setText('');
  }, [text, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const handleClose = useCallback(() => {
    void import('../lib/tauri-windows').then(({ closeCurrentWindow }) => {
      void closeCurrentWindow();
    });
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.titlebar} data-tauri-drag-region="">
        <span className={styles.botIcon} aria-hidden="true">
          🤖
        </span>
        <span className={styles.title}>{BOT.displayName}</span>
        <WindowControls onClose={handleClose} showMinimize={false} />
      </div>
      <div className={styles.messageList} ref={listRef} role="log" aria-live="polite">
        {messages.map((msg) => (
          <BotMessageBubble key={msg.id} msg={msg} />
        ))}
      </div>
      <div className={styles.inputRow}>
        <textarea
          ref={inputRef}
          className={styles.textarea}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, BOT.maxCommandLength));
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('inputPlaceholder')}
          rows={1}
          aria-label={t('inputAriaLabel')}
        />
        <button className={styles.sendButton} onClick={send} disabled={!text.trim()}>
          {t('send')}
        </button>
      </div>
    </div>
  );
}

function BotMessageBubble({ msg }: { msg: BotDmMessage }) {
  const { t, i18n } = useTranslation('bot');
  let displayText = msg.text;
  if (msg.fromBot && msg.i18nKey && i18n.language !== 'en') {
    const translated = t(msg.i18nKey.replace('bot:', ''), { defaultValue: '' }) as string;
    if (translated.length > 0) displayText = translated;
  }
  return (
    <div className={`${styles.message} ${msg.fromBot ? styles.botMessage : styles.userMessage}`}>
      {displayText}
    </div>
  );
}
