import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useGroupCall } from '../contexts/GroupCallContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { MeetLanding } from './MeetPage';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './MeetWindowPage.module.css';

/**
 * Standalone full-window meet page for Tauri desktop windows.
 * Routes: /meet-window and /meet-window/:meetCode
 * GroupCallOverlay (rendered by AuthenticatedApp) handles the in-call UI.
 */
export function MeetWindowPage() {
  const { meetCode } = useParams<{ meetCode?: string }>();
  const { joinByCode } = useGroupCall();
  const { connected } = useWebSocket();

  // Auto-join if a meet code is in the URL (opened from a share link or tray)
  useEffect(() => {
    if (connected && meetCode) {
      joinByCode(meetCode);
    }
  }, [connected, meetCode, joinByCode]);

  return (
    <div className={styles.container}>
      <div className={styles.titlebar} data-tauri-drag-region="">
        <span className={styles.title}>Meet</span>
        <WindowControls showMinimize={false} />
      </div>
      <div className={styles.body}>
        <MeetLanding />
      </div>
    </div>
  );
}
