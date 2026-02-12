import { useState, useRef, useEffect, useCallback } from 'react';
import { StatusIndicator } from './StatusIndicator';
import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';
import { STATUS_OPTIONS, VISIBILITY_OPTIONS } from '../../constants/presence';
import styles from './StatusSelector.module.css';

interface StatusSelectorProps {
  status: PresenceStatus;
  awayMessage?: string;
  visibleTo: PresenceVisibility;
  onChangeStatus: (
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ) => void;
}

export function StatusSelector({
  status,
  awayMessage,
  visibleTo,
  onChangeStatus,
}: StatusSelectorProps) {
  const [open, setOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState(awayMessage ?? '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Focus first option when dropdown opens
  useEffect(() => {
    if (open && dropdownRef.current) {
      const first = dropdownRef.current.querySelector<HTMLElement>('button, input');
      first?.focus();
    }
  }, [open]);

  /** Trap focus inside the dropdown; close on Escape */
  const handleDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'Tab' || !dropdownRef.current) return;

    const focusable = dropdownRef.current.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }, []);

  return (
    <div className={styles.container}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        onClick={() => {
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <StatusIndicator status={status} size="md" />
        <span className={styles.label}>{status}</span>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="menu"
          onKeyDown={handleDropdownKeyDown}
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="menuitem"
              className={`${styles.option} ${status === opt.value ? styles.active : ''}`}
              onClick={() => {
                if (opt.value !== 'away') {
                  onChangeStatus(opt.value);
                  setOpen(false);
                } else {
                  onChangeStatus('away', draftMessage || undefined);
                  setOpen(false);
                }
              }}
            >
              <StatusIndicator status={opt.value} />
              {opt.label}
            </button>
          ))}
          <div className={styles.awaySection}>
            <label className={styles.awayLabel}>Away message</label>
            <input
              className={styles.awayInput}
              type="text"
              placeholder="e.g. BRB, grabbing coffee"
              maxLength={300}
              value={draftMessage}
              onChange={(e) => {
                setDraftMessage(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onChangeStatus('away', draftMessage || undefined);
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className={styles.visibilitySection}>
            <label className={styles.visibilityLabel}>Who can see me</label>
            <div className={styles.visibilityOptions}>
              {VISIBILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.visibilityBtn} ${visibleTo === opt.value ? styles.visibilityActive : ''}`}
                  onClick={() => {
                    onChangeStatus(
                      status,
                      status === 'away' ? draftMessage || undefined : undefined,
                      opt.value,
                    );
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
