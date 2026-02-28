import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useBlocks } from '../../contexts/BlockContext';
import { useRoomMod } from '../../contexts/RoomModContext';
import { addToBuddyList, createBanRecord, createRoleRecord } from '../../lib/atproto';
import { ReportUserModal } from '../feedback/ReportUserModal';
import styles from './MemberMenu.module.css';

interface MemberMenuProps {
  did: string;
  className?: string;
}

export function MemberMenu({ did, className }: MemberMenuProps) {
  const { t } = useTranslation('chat');
  const { agent } = useAuth();
  const { send } = useWebSocket();
  const { blockedDids, canWriteBlocks, toggleBlock } = useBlocks();
  const { roomUri, roomOwnerDid, isCurrentUserOwner, isCurrentUserOwnerOrMod } = useRoomMod();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isBlocked = blockedDids.has(did);
  const isTargetOwner = did === roomOwnerDid;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFeedback(null);
        setConfirmBan(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setFeedback(null);
        setConfirmBan(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

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
          ? t('memberMenu.feedback.added')
          : t('memberMenu.feedback.alreadyInList'),
      );
      timerRef.current = setTimeout(() => {
        setOpen(false);
        setFeedback(null);
      }, 2000);
    } catch {
      setFeedback(t('memberMenu.feedback.error'));
      timerRef.current = setTimeout(() => {
        setFeedback(null);
      }, 2000);
    } finally {
      setPending(false);
    }
  }

  function handleBlock() {
    toggleBlock(did);
    setOpen(false);
  }

  async function handleBan() {
    if (!agent || !roomUri || pending) return;
    setPending(true);
    try {
      await createBanRecord(agent, { roomUri, subjectDid: did });
      setFeedback(t('moderation.banned'));
      setConfirmBan(false);
      timerRef.current = setTimeout(() => {
        setOpen(false);
        setFeedback(null);
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
        setOpen(false);
        setFeedback(null);
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

  return (
    <div className={`${styles.menuWrap}${className ? ` ${className}` : ''}`} ref={menuRef}>
      <button
        className={styles.menuBtn}
        onClick={() => {
          setOpen(!open);
          setFeedback(null);
          setConfirmBan(false);
        }}
        title={t('memberMenu.button.title')}
        aria-label={t('memberMenu.button.ariaLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={12} />
      </button>
      {open && (
        <div className={styles.menuDropdown} role="menu">
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
                {t('memberMenu.addToBuddyList')}
              </button>
              {canWriteBlocks && (
                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={handleBlock}
                  role="menuitem"
                >
                  {isBlocked ? t('memberMenu.unblock') : t('memberMenu.block')}
                </button>
              )}
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setShowReport(true);
                  setOpen(false);
                }}
                role="menuitem"
              >
                {t('memberMenu.report')}
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
      )}
      {showReport && (
        <ReportUserModal
          subjectDid={did}
          onClose={() => {
            setShowReport(false);
          }}
        />
      )}
    </div>
  );
}
