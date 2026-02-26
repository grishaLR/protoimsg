import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useBlocks } from '../../contexts/BlockContext';
import { useRoomMod } from '../../contexts/RoomModContext';
import { addToBuddyList, createBanRecord, createRoleRecord } from '../../lib/atproto';
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
  const { roomUri, roomOwnerDid, isCurrentUserOwner, isCurrentUserOwnerOrMod } = useRoomMod();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isBlocked = blockedDids.has(did);
  const isTargetOwner = did === roomOwnerDid;

  // Clamp position so menu doesn't overflow viewport
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 200),
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  async function handleAddBuddy() {
    if (!agent || pending) return;
    setPending(true);
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
    } finally {
      setPending(false);
    }
  }

  function handleBlock() {
    toggleBlock(did);
    onClose();
  }

  async function handleBan() {
    if (!agent || !roomUri || pending) return;
    setPending(true);
    try {
      await createBanRecord(agent, { roomUri, subjectDid: did });
      setFeedback(t('moderation.banned'));
      setConfirmBan(false);
      timerRef.current = setTimeout(() => {
        onClose();
      }, 2000);
    } catch {
      setFeedback(t('moderation.error'));
      timerRef.current = setTimeout(() => {
        setFeedback(null);
        setConfirmBan(false);
      }, 2000);
    } finally {
      setPending(false);
    }
  }

  async function handleMakeMod() {
    if (!agent || !roomUri || pending) return;
    setPending(true);
    try {
      await createRoleRecord(agent, { roomUri, subjectDid: did, role: 'moderator' });
      setFeedback(t('moderation.modAdded'));
      timerRef.current = setTimeout(() => {
        onClose();
      }, 2000);
    } catch {
      setFeedback(t('moderation.error'));
      timerRef.current = setTimeout(() => {
        setFeedback(null);
      }, 2000);
    } finally {
      setPending(false);
    }
  }

  return createPortal(
    <>
      <div className={styles.overlay} />
      <div className={styles.menu} ref={menuRef} style={style} role="menu">
        {feedback ? (
          <span className={styles.menuFeedback}>{feedback}</span>
        ) : confirmBan ? (
          <>
            <span className={styles.menuFeedback}>{t('moderation.banConfirm')}</span>
            <button
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => void handleBan()}
              disabled={pending}
              role="menuitem"
            >
              {t('moderation.ban')}
            </button>
            <button
              className={styles.menuItem}
              onClick={() => {
                setConfirmBan(false);
              }}
              role="menuitem"
            >
              {t('roomSettings.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.menuItem}
              onClick={() => void handleAddBuddy()}
              disabled={pending}
              role="menuitem"
            >
              {t('userContextMenu.addToBuddyList')}
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={handleBlock}
              role="menuitem"
            >
              {isBlocked ? t('userContextMenu.unblock') : t('userContextMenu.block')}
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => {
                setShowReport(true);
              }}
              role="menuitem"
            >
              {t('userContextMenu.report')}
            </button>
            {isCurrentUserOwnerOrMod && !isTargetOwner && (
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setConfirmBan(true);
                }}
                role="menuitem"
              >
                {t('moderation.ban')}
              </button>
            )}
            {isCurrentUserOwner && !isTargetOwner && (
              <button
                className={styles.menuItem}
                onClick={() => void handleMakeMod()}
                disabled={pending}
                role="menuitem"
              >
                {t('moderation.makeMod')}
              </button>
            )}
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
