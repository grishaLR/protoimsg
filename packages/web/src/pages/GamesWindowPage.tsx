import { GamesPanel } from '../components/games/GamesPanel';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './GamesWindowPage.module.css';

/**
 * Standalone full-window games page for Tauri desktop windows.
 * Route: /games
 */
export function GamesWindowPage() {
  return (
    <div className={styles.container}>
      <div className={styles.titlebar} data-tauri-drag-region="">
        <span className={styles.title}>Games</span>
        <WindowControls showMinimize={false} />
      </div>
      <div className={styles.body}>
        <GamesPanel />
      </div>
    </div>
  );
}
