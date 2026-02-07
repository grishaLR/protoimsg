import { useAuth } from '../../hooks/useAuth';
import { usePresence } from '../../hooks/usePresence';
import { StatusSelector } from '../chat/StatusSelector';
import { UserIdentity } from '../chat/UserIdentity';
import styles from './Header.module.css';

export function Header() {
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
            <span className={styles.did}>
              <UserIdentity did={did} showAvatar size="md" />
            </span>
          </>
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
