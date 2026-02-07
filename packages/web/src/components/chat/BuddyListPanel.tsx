import { useState, useRef, useEffect } from 'react';
import type { Agent } from '@atproto/api';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { resolveDidOrHandle } from '../../lib/resolve-identity';
import type { DoorEvent } from '../../hooks/useBuddyList';
import type { BuddyWithPresence } from '../../types';
import styles from './BuddyListPanel.module.css';

interface BuddyListPanelProps {
  buddies: BuddyWithPresence[];
  doorEvents?: Record<string, DoorEvent>;
  loading: boolean;
  agent: Agent | null;
  onAddBuddy: (did: string) => Promise<void>;
  onRemoveBuddy: (did: string) => Promise<void>;
  onToggleCloseFriend: (did: string) => Promise<void>;
  onBlockBuddy: (did: string) => void;
}

const STATUS_ORDER: Record<string, number> = {
  online: 0,
  away: 1,
  idle: 2,
  offline: 3,
};

function BuddyMenu({
  buddy,
  onRemove,
  onToggleCloseFriend,
  onBlock,
}: {
  buddy: BuddyWithPresence;
  onRemove: () => void;
  onToggleCloseFriend: () => void;
  onBlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  return (
    <div className={styles.menuWrap} ref={menuRef}>
      <button
        className={styles.menuBtn}
        onClick={() => {
          setOpen(!open);
        }}
        title="Options"
      >
        <span className={styles.menuIcon} />
      </button>
      {open && (
        <div className={styles.menuDropdown}>
          <button
            className={styles.menuItem}
            onClick={() => {
              onToggleCloseFriend();
              setOpen(false);
            }}
          >
            {buddy.isCloseFriend ? 'Remove from Close Friends' : 'Add to Close Friends'}
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              onBlock();
              setOpen(false);
            }}
          >
            {buddy.isBlocked ? 'Unblock' : 'Block'}
          </button>
          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

export function BuddyListPanel({
  buddies,
  doorEvents = {},
  loading,
  agent,
  onAddBuddy,
  onRemoveBuddy,
  onToggleCloseFriend,
  onBlockBuddy,
}: BuddyListPanelProps) {
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const sorted = [...buddies].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
  );

  const handleAdd = async () => {
    const input = addInput.trim();
    if (!input || !agent) return;
    setAdding(true);
    setAddError(null);
    try {
      const did = await resolveDidOrHandle(agent, input);
      await onAddBuddy(did);
      setAddInput('');
    } catch {
      setAddError(`Could not resolve "${input}"`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Buddy List</h3>

      <div className={styles.addSection}>
        <input
          className={styles.addInput}
          type="text"
          placeholder="Add buddy (DID or handle)..."
          value={addInput}
          onChange={(e) => {
            setAddInput(e.target.value);
            setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
          disabled={adding}
        />
        <button className={styles.addBtn} onClick={() => void handleAdd()} disabled={adding}>
          Add
        </button>
      </div>
      {addError && <p className={styles.addError}>{addError}</p>}

      {loading ? (
        <p className={styles.empty}>Loading...</p>
      ) : sorted.length === 0 ? (
        <p className={styles.empty}>No buddies yet</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((buddy) => {
            const door = doorEvents[buddy.did];
            const hasAwayMessage = buddy.awayMessage && buddy.status !== 'offline';
            return (
              <li key={buddy.did} className={styles.buddy}>
                {door ? (
                  <span className={styles.doorEmoji}>
                    {door === 'join' ? '\u{1F6AA}\u{2728}' : '\u{1F6AA}\u{1F4A8}'}
                  </span>
                ) : hasAwayMessage ? (
                  <span className={styles.awayBubble} data-tooltip={buddy.awayMessage}>
                    <svg
                      className={styles.awayBubbleSvg}
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6l-3 2.5V11H2a1 1 0 0 1-1-1V3z"
                        fill="#f59e0b"
                      />
                      <circle cx="5.5" cy="6" r="0.75" fill="#fff" />
                      <circle cx="8" cy="6" r="0.75" fill="#fff" />
                      <circle cx="10.5" cy="6" r="0.75" fill="#fff" />
                    </svg>
                  </span>
                ) : (
                  <StatusIndicator status={buddy.status} />
                )}
                <div className={styles.buddyInfo}>
                  <span className={styles.buddyDid}>
                    <UserIdentity did={buddy.did} showAvatar />
                  </span>
                </div>
                <BuddyMenu
                  buddy={buddy}
                  onRemove={() => void onRemoveBuddy(buddy.did)}
                  onToggleCloseFriend={() => void onToggleCloseFriend(buddy.did)}
                  onBlock={() => {
                    onBlockBuddy(buddy.did);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
