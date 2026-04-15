import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { REPORT_CATEGORIES } from '@protoimsg/shared';
import { useProfile } from '../../contexts/ProfileContext';
import { sendReport } from '../../lib/api';
import { MAX_FILE_SIZE, isDataImageUrl, fileToBase64 } from './report-utils';
import styles from './ReportUserModal.module.css';

interface ReportUserModalProps {
  subjectDid: string;
  onClose: () => void;
}

export function ReportUserModal({ subjectDid, onClose }: ReportUserModalProps) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);
  const profile = useProfile(subjectDid);

  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('harassment');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;

      // Filter out oversized files
      const validFiles = files.filter((f) => f.size <= MAX_FILE_SIZE);
      if (validFiles.length < files.length) {
        setError(t('report.fileSizeError'));
      }

      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      try {
        const base64Strings = await Promise.all(validFiles.map(fileToBase64));
        setAttachments((prev) => [...prev, ...base64Strings].slice(0, 2));
      } catch {
        setError(t('report.fileSizeError'));
      }

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [t],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    void sendReport({
      subjectDid,
      category,
      description: description.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
      .then(() => {
        if (!mountedRef.current) return;
        setSuccess(true);
        timerRef.current = setTimeout(() => {
          dialogRef.current?.close();
        }, 1500);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : t('report.error'));
        setSubmitting(false);
      });
  }

  const displayName = profile?.handle ? `@${profile.handle}` : subjectDid;

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h2 className={styles.title}>{t('report.title')}</h2>

        {success ? (
          <p className={styles.success} role="status">
            {t('report.success')}
          </p>
        ) : (
          <>
            <div className={styles.label}>
              {t('report.subjectLabel')}
              <span className={styles.subjectValue}>{displayName}</span>
            </div>

            <label className={styles.label}>
              {t('report.categoryLabel')}
              <select
                className={styles.select}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as (typeof REPORT_CATEGORIES)[number]);
                }}
              >
                {REPORT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {t(`report.categories.${cat}` as `report.categories.harassment`)}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              {t('report.descriptionLabel')}
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value.slice(0, 1000));
                }}
                placeholder={t('report.descriptionPlaceholder')}
                rows={3}
              />
            </label>

            <div className={styles.attachSection}>
              <div className={styles.label}>
                {t('report.attachmentsLabel')}
                <span className={styles.attachHint}>{t('report.attachmentsHint')}</span>
              </div>

              {attachments.length > 0 && (
                <div className={styles.previews}>
                  {attachments.map((src, i) => (
                    <div key={i} className={styles.previewThumb}>
                      {isDataImageUrl(src) && (
                        // eslint-disable-next-line no-restricted-syntax -- validated by isDataImageUrl
                        <img src={src} alt="" className={styles.previewImg} />
                      )}
                      <button
                        type="button"
                        className={styles.previewRemove}
                        onClick={() => {
                          removeAttachment(i);
                        }}
                        aria-label={t('report.removeAttachment')}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => void handleFileChange(e)}
              />
              <button
                type="button"
                className={styles.attachButton}
                disabled={attachments.length >= 2}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('report.addAttachment')}
              </button>
            </div>

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
                {t('report.cancel')}
              </button>
              <button type="submit" className={styles.submitButton} disabled={submitting}>
                {submitting ? t('report.submitting') : t('report.submit')}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
