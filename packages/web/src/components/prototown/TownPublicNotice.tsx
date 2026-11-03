import { useTranslation } from 'react-i18next';
import styles from './TownPublicNotice.module.css';

interface TownPublicNoticeProps {
  /** Friends-of-friends mode is on (the default). */
  fof: boolean;
  onTurnOnFof: () => void;
  onDismiss: () => void;
}

/**
 * Shown once, on your first arrival in the square: town is public — people in
 * the same space can see you, whatever your buddy-list visibility says. The
 * safeguards are places and modes (home, friends of friends), so say so.
 * Offers the narrower mode in one tap; going fully public stays a deliberate
 * choice made from the HUD toggle.
 */
export function TownPublicNotice({ fof, onTurnOnFof, onDismiss }: TownPublicNoticeProps) {
  const { t } = useTranslation('common');
  return (
    <section className={styles.card} aria-labelledby="town-public-notice-title">
      <h2 id="town-public-notice-title" className={styles.title}>
        {t('town.publicNotice.title')}
      </h2>
      <p className={styles.body}>
        {t(fof ? 'town.publicNotice.bodyFof' : 'town.publicNotice.bodyOpen')}
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onDismiss}>
          {t('town.publicNotice.ok')}
        </button>
        {!fof && (
          <button type="button" className={styles.button} onClick={onTurnOnFof}>
            {t('town.publicNotice.turnOnFof')}
          </button>
        )}
      </div>
    </section>
  );
}
