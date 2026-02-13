import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useBlocks } from '../../contexts/BlockContext';
import { addToBuddyList } from '../../lib/atproto';
import styles from './MemberMenu.module.css';

interface MemberMenuProps {
  did: string;
  className?: string;
}

export function MemberMenu({ did, className }: MemberMenuProps) {
  const { agent } = useAuth();
  const { send } = useWebSocket();
  const { blockedDids, toggleBlock } = useBlocks();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isBlocked = blockedDids.has(did);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFeedback(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  async function handleAddBuddy() {
    if (!agent) return;
    try {
      const result = await addToBuddyList(agent, send, did);
      setFeedback(result === 'added' ? 'Added!' : 'Already in buddy list');
      setTimeout(() => {
        setOpen(false);
        setFeedback(null);
      }, 2000);
    } catch {
      setFeedback('Error adding buddy');
      setTimeout(() => {
        setFeedback(null);
      }, 2000);
    }
  }

  function handleBlock() {
    toggleBlock(did);
    setOpen(false);
  }

  return (
    <div className={`${styles.menuWrap}${className ? ` ${className}` : ''}`} ref={menuRef}>
      <button
        className={styles.menuBtn}
        onClick={() => {
          setOpen(!open);
          setFeedback(null);
        }}
        title="Options"
        aria-label="Member options"
      >
        <span className={styles.menuIcon} />
      </button>
      {open && (
        <div className={styles.menuDropdown}>
          {feedback ? (
            <span className={styles.menuFeedback}>{feedback}</span>
          ) : (
            <>
              <button className={styles.menuItem} onClick={() => void handleAddBuddy()}>
                Add to Buddy List
              </button>
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={handleBlock}
              >
                {isBlocked ? 'Unblock' : 'Block'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
