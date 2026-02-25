import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import styles from './BetaBanner.module.css';

const DISMISSED_KEY = 'protoimsg:betaBannerDismissed';

export function BetaBanner() {
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === '1');

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className={styles.banner} role="status">
      <span>
        {t('betaBanner.message')}{' '}
        <a href="mailto:protoimsg@gmail.com" className={styles.link}>
          protoimsg@gmail.com
        </a>
        {' or '}
        <a
          href="https://bsky.app/profile/grishalr.protoimsg.app"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          @grishalr.protoimsg.app
        </a>
      </span>
      <button
        className={styles.dismissBtn}
        onClick={handleDismiss}
        title={t('betaBanner.dismiss')}
        aria-label={t('betaBanner.dismiss')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
