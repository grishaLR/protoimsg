import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, ChevronUp, X } from 'lucide-react';
import { BOT } from '@protoimsg/shared';
import { useBotDm } from '../../contexts/BotDmContext';
import styles from './BotDmPopover.module.css';

export function BotDmPopover() {
  const { t } = useTranslation('bot');
  const { isOpen, messages, minimized, closeBotDm, sendMessage, toggleMinimize } = useBotDm();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when expanded
  useEffect(() => {
    if (!minimized && isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [minimized, isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setText('');
  }

  const expanded = !minimized;

  return (
    <div
      className={`${styles.popover} ${minimized ? styles.minimized : ''}`}
      aria-label={t('ariaLabel')}
    >
      <div
        className={styles.header}
        onClick={toggleMinimize}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMinimize();
          }
        }}
      >
        <span className={styles.botIcon} aria-hidden="true">
          {'\u{1F916}'}
        </span>
        <div className={styles.headerInfo}>
          <div className={styles.headerName}>{BOT.displayName}</div>
          <div className={styles.headerStatus}>{t('alwaysOnline')}</div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize();
            }}
            title={minimized ? t('expand') : t('minimize')}
            aria-label={minimized ? t('expand') : t('minimize')}
          >
            {minimized ? <ChevronUp size={14} /> : <Minus size={14} />}
          </button>
          <button
            className={styles.headerBtn}
            onClick={(e) => {
              e.stopPropagation();
              closeBotDm();
            }}
            title={t('close')}
            aria-label={t('close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className={minimized ? `${styles.body} ${styles.bodyHidden}` : styles.body}>
        <div className={styles.messageList} ref={listRef} role="log" aria-live="polite">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${msg.fromBot ? styles.botMessage : styles.userMessage}`}
            >
              {msg.text}
            </div>
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
    </div>
  );
}
