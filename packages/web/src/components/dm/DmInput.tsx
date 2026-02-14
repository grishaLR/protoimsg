import {
  forwardRef,
  useState,
  useRef,
  useImperativeHandle,
  useEffect,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DM_LIMITS } from '@protoimsg/shared';
import styles from './DmInput.module.css';

interface DmInputProps {
  onSend: (text: string) => void;
  onTyping: () => void;
}

export const DmInput = forwardRef<HTMLTextAreaElement, DmInputProps>(function DmInput(
  { onSend, onTyping },
  ref,
) {
  const { t } = useTranslation('dm');
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (value: string) => {
    if (value.length > DM_LIMITS.maxMessageLength) return;
    setText(value);
    // M12: Only fire typing when there's actual text
    if (value.length > 0) {
      onTyping();
    }
  };

  // Auto-resize textarea via effect (L6: after React commits the new value)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
    }
  }, [text]);

  return (
    <div className={styles.inputArea}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('input.placeholder')}
        rows={1}
        aria-label={t('input.ariaLabel')}
      />
      <button className={styles.sendBtn} onClick={handleSend} disabled={!text.trim()} type="button">
        {t('input.send')}
      </button>
    </div>
  );
});
