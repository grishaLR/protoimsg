import { useAuth } from '../../hooks/useAuth';
import styles from './Header.module.css';

export function Header() {
  const { did, logout } = useAuth();

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Chatmosphere</h1>
      <div className={styles.right}>
        {did && <span className={styles.did}>{did}</span>}
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
