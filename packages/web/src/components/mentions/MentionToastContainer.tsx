import { useNavigate } from 'react-router-dom';
import { useMentionNotifications } from '../../contexts/MentionNotificationContext';
import { MentionToast } from './MentionToast';
import styles from './MentionToastContainer.module.css';

export function MentionToastContainer() {
  const { toasts, dismissToast } = useMentionNotifications();
  const navigate = useNavigate();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-live="polite" aria-label="Mention notifications">
      {toasts.map((toast) => (
        <MentionToast
          key={toast.id}
          notification={toast}
          onNavigate={() => {
            dismissToast(toast.id);
            void navigate(`/rooms/${toast.roomId}`);
          }}
          onDismiss={() => {
            dismissToast(toast.id);
          }}
        />
      ))}
    </div>
  );
}
