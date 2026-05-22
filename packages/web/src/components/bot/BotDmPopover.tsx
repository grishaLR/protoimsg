import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, ChevronUp, X } from 'lucide-react';
import { BOT } from '@protoimsg/shared';
import { useBotDm, type BotDmMessage } from '../../contexts/BotDmContext';
import { useDragResize } from '../../hooks/useDragResize';
import styles from './BotDmPopover.module.css';

const DRAG_THRESHOLD = 4;

export function BotDmPopover() {
  const { t } = useTranslation('bot');
  const { isOpen, messages, minimized, closeBotDm, sendMessage, toggleMinimize } = useBotDm();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const expanded = !minimized;
  const {
    containerRef,
    posStyle,
    sizeStyle,
    onDragStart,
    onPointerMove,
    onPointerUp,
    onResizeStart,
    reset,
  } = useDragResize({
    minWidth: 240,
    minHeight: 180,
    enabled: expanded,
  });

  // Reset position/size when minimized
  useEffect(() => {
    if (minimized) {
      reset();
    }
  }, [minimized, reset]);

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

  // Drag/click disambiguation
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (expanded) {
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      onDragStart(e);
    }
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (dragStartPos.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      const moved = Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD;
      dragStartPos.current = null;
      if (!moved) {
        toggleMinimize();
      }
    } else if (minimized) {
      toggleMinimize();
    }
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMinimize();
    }
  };

  // The /bot route renders its own full-window chat — suppress the floating popover there
  if (!isOpen || window.location.pathname === '/bot') return null;

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

  return (
    <div
      ref={containerRef}
      className={`${styles.popover} ${minimized ? styles.minimized : ''}`}
      style={{ ...posStyle, ...sizeStyle }}
      aria-label={t('ariaLabel')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Resize handles — only when expanded */}
      {expanded && (
        <>
          <div
            className={`${styles.resizeHandle} ${styles.resizeN}`}
            onPointerDown={(e) => {
              onResizeStart('n', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeS}`}
            onPointerDown={(e) => {
              onResizeStart('s', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeE}`}
            onPointerDown={(e) => {
              onResizeStart('e', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeW}`}
            onPointerDown={(e) => {
              onResizeStart('w', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeNE}`}
            onPointerDown={(e) => {
              onResizeStart('ne', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeNW}`}
            onPointerDown={(e) => {
              onResizeStart('nw', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeSE}`}
            onPointerDown={(e) => {
              onResizeStart('se', e);
            }}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeSW}`}
            onPointerDown={(e) => {
              onResizeStart('sw', e);
            }}
          />
        </>
      )}

      <div
        className={styles.header}
        onPointerDown={handleHeaderPointerDown}
        onPointerUp={handleHeaderPointerUp}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        style={{ cursor: expanded ? 'grab' : 'pointer', touchAction: 'none' }}
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
