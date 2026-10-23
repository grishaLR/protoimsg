import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TownBetaNotice.module.css';

const DISMISSED_KEY = 'protoimsg:townBetaDismissed';
const WORKS = ['work1', 'work2', 'work3', 'work4'] as const;
const SOON = ['soon1', 'soon2', 'soon3'] as const;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Under construction" notice for proto town: a dismissible banner, plus a
 * small BETA button that stays put afterwards. Both open a short, plain list
 * of what works today and what's coming.
 */
export function TownBetaNotice({
  onBannerChange,
}: {
  /** Whether the full-width banner is showing (so the HUD can make room). */
  onBannerChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    onBannerChange?.(!dismissed);
  }, [dismissed, onBannerChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const dismiss = (): void => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <>
      {dismissed ? (
        <button
          type="button"
          className={styles.betaChip}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('town.beta.chip')}
        </button>
      ) : (
        <div className={styles.banner} role="status">
          <span>{t('town.beta.message')}</span>
          <button
            type="button"
            className={styles.more}
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('town.beta.more')}
          </button>
          <button
            type="button"
            className={styles.dismiss}
            aria-label={t('town.beta.dismiss')}
            title={t('town.beta.dismiss')}
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="town-beta-title"
        onClose={() => {
          setOpen(false);
        }}
      >
        <h2 id="town-beta-title" className={styles.title}>
          {t('town.beta.title')}
        </h2>
        <h3 className={styles.heading}>{t('town.beta.worksHeading')}</h3>
        <ul className={styles.list}>
          {WORKS.map((k) => (
            <li key={k}>{t(`town.beta.${k}`)}</li>
          ))}
        </ul>
        <h3 className={styles.heading}>{t('town.beta.soonHeading')}</h3>
        <ul className={styles.list}>
          {SOON.map((k) => (
            <li key={k}>{t(`town.beta.${k}`)}</li>
          ))}
        </ul>
        <p className={styles.footer}>{t('town.beta.feedback')}</p>
        <button
          type="button"
          className={styles.close}
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('town.beta.close')}
        </button>
      </dialog>
    </>
  );
}
