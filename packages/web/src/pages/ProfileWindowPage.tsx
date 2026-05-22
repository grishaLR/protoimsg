import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ProfileView } from '../components/chat/ProfileView';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './ProfileWindowPage.module.css';

/**
 * Standalone full-window profile page for Tauri desktop windows.
 * Route: /profile/:did
 */
export function ProfileWindowPage() {
  const { did } = useParams<{ did: string }>();

  const handleClose = useCallback(() => {
    void import('../lib/tauri-windows').then(({ closeCurrentWindow }) => {
      void closeCurrentWindow();
    });
  }, []);

  if (!did) return null;

  return (
    <div className={styles.container}>
      <div className={styles.titlebar} data-tauri-drag-region="">
        <span className={styles.title}>Profile</span>
        <WindowControls onClose={handleClose} showMinimize={false} />
      </div>
      <div className={styles.body}>
        <ProfileView actor={decodeURIComponent(did)} onBack={handleClose} />
      </div>
    </div>
  );
}
