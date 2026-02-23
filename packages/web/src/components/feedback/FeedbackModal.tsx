import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendFeedback } from '../../lib/api';
import styles from './FeedbackModal.module.css';

interface FeedbackModalProps {
  onClose: () => void;
}

export function FeedbackModal({ onClose }: FeedbackModalProps) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    const el = dialogRef.current;
    if (!el) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    previousActiveRef.current?.focus();
    onClose();
  }, [onClose]);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!message.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    void sendFeedback(message.trim())
      .then(() => {
        if (!mountedRef.current) return;
        setSuccess(true);
        timerRef.current = setTimeout(() => {
          dialogRef.current?.close();
        }, 1500);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : t('feedback.error'));
        setSubmitting(false);
      });
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h2 className={styles.title}>{t('feedback.title')}</h2>

        {success ? (
          <p className={styles.success} role="status">
            {t('feedback.success')}
          </p>
        ) : (
          <>
            <textarea
              className={styles.textarea}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value.slice(0, 2000));
              }}
              placeholder={t('feedback.placeholder')}
              rows={4}
              autoFocus
              required
            />

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => dialogRef.current?.close()}
              >
                {t('feedback.cancel')}
              </button>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={submitting || !message.trim()}
              >
                {submitting ? t('feedback.sending') : t('feedback.submit')}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
