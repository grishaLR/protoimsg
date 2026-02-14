import { useTranslation } from 'react-i18next';
import { useDm } from '../../contexts/DmContext';
import { useAuth } from '../../hooks/useAuth';
import { IS_TAURI } from '../../lib/config';
import { DmPopover } from './DmPopover';
import { DmNotificationBadge } from './DmNotificationBadge';
import styles from './DmPopoverContainer.module.css';

export function DmPopoverContainer() {
  const { t } = useTranslation('dm');
  const {
    conversations,
    notifications,
    closeDm,
    toggleMinimize,
    sendDm,
    sendTyping,
    togglePersist,
    dismissNotification,
    openFromNotification,
  } = useDm();
  const { did } = useAuth();

  if (!did) return null;

  // In Tauri mode, DMs open as separate OS windows — skip popover rendering
  if (IS_TAURI) return null;

  return (
    <div className={styles.container}>
      {conversations.map((convo) => (
        <DmPopover
          key={convo.conversationId}
          conversation={convo}
          currentDid={did}
          onClose={() => {
            closeDm(convo.conversationId);
          }}
          onToggleMinimize={() => {
            toggleMinimize(convo.conversationId);
          }}
          onSend={(text) => {
            sendDm(convo.conversationId, text);
          }}
          onTyping={() => {
            sendTyping(convo.conversationId);
          }}
          onTogglePersist={(persist) => {
            togglePersist(convo.conversationId, persist);
          }}
        />
      ))}
      <div aria-live="polite" aria-label={t('popoverContainer.ariaLabel')}>
        {notifications.map((n) => (
          <DmNotificationBadge
            key={n.conversationId}
            notification={n}
            onOpen={() => {
              openFromNotification(n);
            }}
            onDismiss={() => {
              dismissNotification(n.conversationId);
            }}
          />
        ))}
      </div>
    </div>
  );
}
