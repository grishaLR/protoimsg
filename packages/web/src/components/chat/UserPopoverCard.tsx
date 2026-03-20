import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, ExternalLink } from 'lucide-react';
import { useProfile } from '../../contexts/ProfileContext';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { addToBuddyList } from '../../lib/atproto';
import { isSafeUrl } from '../../lib/sanitize';
import styles from './UserPopoverCard.module.css';

interface UserPopoverCardProps {
  did: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onViewProfile?: (did: string) => void;
}

export function UserPopoverCard({ did, anchorRect, onClose, onViewProfile }: UserPopoverCardProps) {
  const { t } = useTranslation('chat');
  const profile = useProfile(did);
  const { agent, did: currentUserDid } = useAuth();
  const { send } = useWebSocket();
  const cardRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isSelf = did === currentUserDid;

  // Position: below the anchor, aligned left
  const style: React.CSSProperties = {
    left: Math.min(anchorRect.left, window.innerWidth - 260),
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 200),
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
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

  const handleAddBuddy = useCallback(async () => {
    if (!agent || pending) return;
    setPending(true);
    try {
      const result = await addToBuddyList(agent, send, did);
      setFeedback(
        result === 'added' ? t('userPopoverCard.added') : t('userPopoverCard.alreadyInList'),
      );
      timerRef.current = setTimeout(onClose, 2000);
    } catch {
      setFeedback(t('userPopoverCard.error'));
      timerRef.current = setTimeout(() => {
        setFeedback(null);
      }, 2000);
    } finally {
      setPending(false);
    }
  }, [agent, pending, send, did, t, onClose]);

  const handleViewProfile = useCallback(() => {
    onViewProfile?.(did);
    onClose();
  }, [onViewProfile, did, onClose]);

  const displayName = profile?.displayName || profile?.handle || did;
  const handle = profile ? `@${profile.handle}` : did;
  const hasAvatar = profile?.avatarUrl && isSafeUrl(profile.avatarUrl);
  const initial = (profile?.handle[0] ?? did.at(-1) ?? '?').toUpperCase();

  return createPortal(
    <>
      <div className={styles.overlay} />
      <div className={styles.card} ref={cardRef} style={style}>
        <div className={styles.header}>
          {hasAvatar ? (
            <img
              className={styles.avatar}
              // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
              src={profile.avatarUrl}
              width={40}
              height={40}
              alt=""
            />
          ) : (
            <span className={styles.initialAvatar} aria-hidden="true">
              {initial}
            </span>
          )}
          <div className={styles.names}>
            <span className={styles.displayName}>{displayName}</span>
            <span className={styles.handle}>{handle}</span>
          </div>
        </div>
        <div className={styles.actions}>
          {feedback ? (
            <span className={styles.feedback}>{feedback}</span>
          ) : (
            <>
              {onViewProfile && (
                <button className={styles.actionBtn} onClick={handleViewProfile} type="button">
                  <ExternalLink size={14} />
                  {t('userPopoverCard.viewProfile')}
                </button>
              )}
              {!isSelf && (
                <button
                  className={styles.actionBtn}
                  onClick={() => void handleAddBuddy()}
                  disabled={pending}
                  type="button"
                >
                  <UserPlus size={14} />
                  {t('userPopoverCard.addToBuddyList')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
