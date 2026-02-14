import type { MentionNotification } from '../../contexts/MentionNotificationContext';
import { UserIdentity } from '../chat/UserIdentity';
import styles from './MentionToast.module.css';

interface MentionToastProps {
  notification: MentionNotification;
  onNavigate: () => void;
  onDismiss: () => void;
}

export function MentionToast({ notification, onNavigate, onDismiss }: MentionToastProps) {
  return (
    <div
      className={styles.notification}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      aria-label={`Mentioned in ${notification.roomName} by ${notification.senderDid}: ${notification.messageText}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate();
        } else if (e.key === 'Escape') {
          onDismiss();
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.roomName}>{notification.roomName}</div>
        <div className={styles.sender}>
          <UserIdentity did={notification.senderDid} showAvatar size="sm" />
        </div>
        <div className={styles.preview}>{notification.messageText}</div>
      </div>
      <button
        className={styles.closeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        title="Dismiss"
        aria-label="Dismiss notification"
        type="button"
      >
        {'\u2715'}
      </button>
    </div>
  );
}
