import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useBlocks } from '../../contexts/BlockContext';
import { addToBuddyList } from '../../lib/atproto';
import { ReportUserModal } from '../feedback/ReportUserModal';
import styles from './UserContextMenu.module.css';

interface UserContextMenuProps {
  did: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function UserContextMenu({ did, x, y, onClose }: UserContextMenuProps) {
  const { t } = useTranslation('chat');
  const { agent } = useAuth();
  const { send } = useWebSocket();
  const { blockedDids, toggleBlock } = useBlocks();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isBlocked = blockedDids.has(did);

  // Clamp position so menu doesn't overflow viewport
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 160),
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  async function handleAddBuddy() {
    if (!agent) return;
    try {
      const result = await addToBuddyList(agent, send, did);
      setFeedback(
        result === 'added'
          ? t('userContextMenu.feedback.added')
          : t('userContextMenu.feedback.alreadyInList'),
      );
      timerRef.current = setTimeout(() => {
        onClose();
      }, 2000);
    } catch {
      setFeedback(t('userContextMenu.feedback.error'));
      timerRef.current = setTimeout(() => {
        setFeedback(null);
      }, 2000);
    }
  }

  function handleBlock() {
    toggleBlock(did);
    onClose();
  }

  return createPortal(
    <>
      <div className={styles.overlay} />
      <div className={styles.menu} ref={menuRef} style={style}>
        {feedback ? (
          <span className={styles.menuFeedback}>{feedback}</span>
        ) : (
          <>
            <button className={styles.menuItem} onClick={() => void handleAddBuddy()}>
              {t('userContextMenu.addToBuddyList')}
            </button>
            <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handleBlock}>
              {isBlocked ? t('userContextMenu.unblock') : t('userContextMenu.block')}
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => {
                setShowReport(true);
              }}
            >
              {t('userContextMenu.report')}
            </button>
          </>
        )}
      </div>
      {showReport && (
        <ReportUserModal
          subjectDid={did}
          onClose={() => {
            setShowReport(false);
            onClose();
          }}
        />
      )}
    </>,
    document.body,
  );
}
