import { useAuth } from '../../hooks/useAuth';
import { usePresence } from '../../hooks/usePresence';
import { StatusSelector } from '../chat/StatusSelector';
import { UserIdentity } from '../chat/UserIdentity';
import styles from './Header.module.css';

interface HeaderProps {
  onOpenSettings?: () => void;
  onOpenProfile?: (did: string) => void;
}

export function Header({ onOpenSettings, onOpenProfile }: HeaderProps) {
  const { did, logout } = useAuth();
  const { status, awayMessage, visibleTo, changeStatus } = usePresence();

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Chatmosphere</h1>
      <div className={styles.right}>
        {did && (
          <>
            <StatusSelector
              status={status}
              awayMessage={awayMessage}
              visibleTo={visibleTo}
              onChangeStatus={changeStatus}
            />
            <span
              className={`${styles.did} ${onOpenProfile ? styles.didClickable : ''}`}
              onClick={() => {
                onOpenProfile?.(did);
              }}
            >
              <UserIdentity did={did} showAvatar size="md" />
            </span>
          </>
        )}
        {onOpenSettings && (
          <button
            className={styles.settingsButton}
            onClick={onOpenSettings}
            type="button"
            title="Settings"
          >
            &#x2699;
          </button>
        )}
        <button
          className={styles.logoutButton}
          onClick={() => {
            logout();
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
