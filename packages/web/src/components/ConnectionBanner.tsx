import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IS_TAURI } from '../lib/config';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../hooks/useAuth';
import styles from './ConnectionBanner.module.css';

export function ConnectionBanner() {
  const { t } = useTranslation('common');
  const { connected } = useWebSocket();
  const { did } = useAuth();
  const [isChildWindow, setIsChildWindow] = useState(false);

  useEffect(() => {
    if (!IS_TAURI) return;
    void import('../lib/tauri-windows').then(({ isMainWindow }) => {
      setIsChildWindow(!isMainWindow());
    });
  }, []);

  // Only show if user is authenticated but WS is disconnected
  // In Tauri child windows, hide the banner — IPC relay handles connectivity
  if (!did || connected || isChildWindow) return null;

  return (
    <div className={styles.banner} role="alert">
      {t('connectionBanner.message')}
    </div>
  );
}
