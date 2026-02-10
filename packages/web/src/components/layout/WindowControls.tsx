import { IS_TAURI } from '../../lib/config';
import styles from './WindowControls.module.css';

interface WindowControlsProps {
  onClose?: () => void;
  showMinimize?: boolean;
}

function handleMinimize() {
  void import('../../lib/tauri-windows').then(({ minimizeCurrentWindow }) => {
    void minimizeCurrentWindow();
  });
}

function handleClose() {
  void import('../../lib/tauri-windows').then(({ closeCurrentWindow }) => {
    void closeCurrentWindow();
  });
}

/**
 * Native-style window control buttons (minimize, close) for frameless Tauri windows.
 * Only renders in Tauri mode. In browser mode, returns null.
 */
export function WindowControls({ onClose, showMinimize = true }: WindowControlsProps) {
  if (!IS_TAURI) return null;

  const closeHandler = onClose ?? handleClose;

  return (
    <div className={styles.controls}>
      {showMinimize && (
        <button className={styles.btn} onClick={handleMinimize} title="Minimize">
          {'\u2013'}
        </button>
      )}
      <button className={`${styles.btn} ${styles.closeBtn}`} onClick={closeHandler} title="Close">
        {'\u2715'}
      </button>
    </div>
  );
}
