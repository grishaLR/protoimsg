import { useState } from 'react';
import { StatusIndicator } from './StatusIndicator';
import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';
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

const STATUS_OPTIONS: Array<{ value: PresenceStatus; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'away', label: 'Away' },
  { value: 'idle', label: 'Idle' },
];

const VISIBILITY_OPTIONS: Array<{ value: PresenceVisibility; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'close-friends', label: 'Close Friends' },
  { value: 'nobody', label: 'Nobody' },
];

export function StatusSelector({
  status,
  awayMessage,
  visibleTo,
  onChangeStatus,
}: StatusSelectorProps) {
  const [open, setOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState(awayMessage ?? '');

  return (
    <div className={styles.container}>
      <button
        className={styles.trigger}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <StatusIndicator status={status} size="md" />
        <span className={styles.label}>{status}</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
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
