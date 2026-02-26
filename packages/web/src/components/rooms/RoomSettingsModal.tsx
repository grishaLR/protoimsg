import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { extractRkey } from '../../lib/atproto';
import type { RoomView } from '../../types';
import styles from './RoomSettingsModal.module.css';

interface RoomSettingsModalProps {
  room: RoomView;
  onClose: () => void;
}

const MAX_SLOW_MODE_SECONDS = 3600;
const MAX_MIN_ACCOUNT_AGE_DAYS = 365;

export function RoomSettingsModal({ room, onClose }: RoomSettingsModalProps) {
  const { t } = useTranslation('chat');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { agent } = useAuth();

  const [slowMode, setSlowMode] = useState(room.slow_mode_seconds);
  const [minAge, setMinAge] = useState(room.min_account_age_days);
  const [allowlist, setAllowlist] = useState(room.allowlist_enabled);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    el.showModal();
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    previousActiveRef.current?.focus();
    onClose();
  }, [onClose]);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!agent) return;

    setSubmitting(true);
    setError(null);
    setSaved(false);

    try {
      // Fetch current record to preserve all fields
      const rkey = extractRkey(room.uri);
      const current = await agent.com.atproto.repo.getRecord({
        repo: agent.assertDid,
        collection: 'app.protoimsg.chat.room',
        rkey,
      });

      const record = current.data.value as Record<string, unknown>;
      const existingSettings = (record.settings ?? {}) as Record<string, unknown>;

      // PUT updated record with CAS (swapRecord) to prevent TOCTOU
      await agent.com.atproto.repo.putRecord({
        repo: agent.assertDid,
        collection: 'app.protoimsg.chat.room',
        rkey,
        swapRecord: current.data.cid,
        record: {
          ...record,
          settings: {
            ...existingSettings,
            slowModeSeconds: slowMode,
            minAccountAgeDays: minAge,
            allowlistEnabled: allowlist,
          },
        },
      });

      setSaved(true);
      savedTimerRef.current = setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('roomSettings.error'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <h2 className={styles.title}>{t('roomSettings.title')}</h2>

        <label className={styles.label}>
          {t('roomSettings.slowMode')}
          <input
            className={styles.input}
            type="number"
            min={0}
            max={MAX_SLOW_MODE_SECONDS}
            value={slowMode}
            onChange={(e) => {
              setSlowMode(
                Math.min(MAX_SLOW_MODE_SECONDS, Math.max(0, parseInt(e.target.value, 10) || 0)),
              );
            }}
          />
          <span className={styles.hint}>{t('roomSettings.slowModeHint')}</span>
        </label>

        <label className={styles.label}>
          {t('roomSettings.minAccountAge')}
          <input
            className={styles.input}
            type="number"
            min={0}
            max={MAX_MIN_ACCOUNT_AGE_DAYS}
            value={minAge}
            onChange={(e) => {
              setMinAge(
                Math.min(MAX_MIN_ACCOUNT_AGE_DAYS, Math.max(0, parseInt(e.target.value, 10) || 0)),
              );
            }}
          />
        </label>

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={allowlist}
            onChange={(e) => {
              setAllowlist(e.target.checked);
            }}
          />
          {t('roomSettings.allowlist')}
          <span className={styles.hint}>{t('roomSettings.allowlistHint')}</span>
        </label>

        {error && <p className={styles.error}>{error}</p>}
        {saved && <p className={styles.saved}>{t('roomSettings.saved')}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => dialogRef.current?.close()}
          >
            {t('roomSettings.cancel')}
          </button>
          <button type="submit" className={styles.submitButton} disabled={submitting || saved}>
            {submitting ? t('roomSettings.saving') : t('roomSettings.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
