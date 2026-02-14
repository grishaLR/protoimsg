import { useTranslation } from 'react-i18next';
import type { DmNotification } from '../../contexts/DmContext';
import { UserIdentity } from '../chat/UserIdentity';
import styles from './DmNotificationBadge.module.css';

interface DmNotificationBadgeProps {
  notification: DmNotification;
  onOpen: () => void;
  onDismiss: () => void;
}

export function DmNotificationBadge({ notification, onOpen, onDismiss }: DmNotificationBadgeProps) {
  const { t } = useTranslation('dm');

  return (
    <div
      className={styles.notification}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={t('notification.ariaLabel', {
        senderDid: notification.senderDid,
        preview: notification.preview,
      })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.key === 'Escape') {
          onDismiss();
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.sender}>
          <UserIdentity did={notification.senderDid} showAvatar size="sm" />
        </div>
        <div className={styles.preview}>{notification.preview}</div>
      </div>
      <button
        className={styles.closeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        title={t('notification.dismiss.title')}
        aria-label={t('notification.dismiss.ariaLabel')}
        type="button"
      >
        {'\u2715'}
      </button>
    </div>
  );
}
