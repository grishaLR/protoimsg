import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './InfoTip.module.css';

interface InfoTipProps {
  text: ReactNode;
  placement?: 'above' | 'below';
}

export function InfoTip({ text, placement = 'above' }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const top = placement === 'below' ? rect.bottom + 8 : rect.top - 8;
      setPos({ top, left: rect.left + rect.width / 2 });
    }
  }, [placement]);

  const show = useCallback(() => {
    updatePos();
    setOpen(true);
  }, [updatePos]);

  const handleClick = useCallback(() => {
    updatePos();
    setPinned((prev) => !prev);
    setOpen((prev) => !prev);
  }, [updatePos]);

  // Close on outside tap when pinned
  useEffect(() => {
    if (!pinned) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className={styles.trigger}
      onClick={handleClick}
      onMouseEnter={show}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      ?
      {open && (
        <div
          className={styles.popover}
          style={{
            top: pos.top,
            left: pos.left,
            transform: placement === 'below' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
