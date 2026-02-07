import { useState } from 'react';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import type { DoorEvent } from '../../hooks/useBuddyList';
import type { BuddyWithPresence } from '../../types';
import styles from './BuddyListPanel.module.css';

interface BuddyListPanelProps {
  buddies: BuddyWithPresence[];
  doorEvents?: Record<string, DoorEvent>;
  loading: boolean;
  onAddBuddy: (did: string) => Promise<void>;
  onRemoveBuddy: (did: string) => Promise<void>;
}

const STATUS_ORDER: Record<string, number> = {
  online: 0,
  away: 1,
  idle: 2,
  offline: 3,
};

export function BuddyListPanel({
  buddies,
  doorEvents = {},
  loading,
  onAddBuddy,
  onRemoveBuddy,
}: BuddyListPanelProps) {
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);

  const sorted = [...buddies].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
  );

  const handleAdd = async () => {
    const did = addInput.trim();
    if (!did) return;
    setAdding(true);
    await onAddBuddy(did);
    setAddInput('');
    setAdding(false);
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Buddy List</h3>

      <div className={styles.addSection}>
        <input
          className={styles.addInput}
          type="text"
          placeholder="Add buddy (DID)..."
          value={addInput}
          onChange={(e) => {
            setAddInput(e.target.value);
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

      {loading ? (
        <p className={styles.empty}>Loading...</p>
      ) : sorted.length === 0 ? (
        <p className={styles.empty}>No buddies yet</p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((buddy) => {
            const door = doorEvents[buddy.did];
            return (
              <li key={buddy.did} className={styles.buddy}>
                {door ? (
                  <span className={styles.doorEmoji}>
                    {door === 'join' ? '\u{1F6AA}\u{2728}' : '\u{1F6AA}\u{1F4A8}'}
                  </span>
                ) : (
                  <StatusIndicator status={buddy.status} />
                )}
                <div className={styles.buddyInfo}>
                  <span className={styles.buddyDid}>
                    <UserIdentity did={buddy.did} showAvatar />
                  </span>
                  {buddy.awayMessage && <span className={styles.awayMsg}>{buddy.awayMessage}</span>}
                </div>
                <button
                  className={styles.removeBtn}
                  onClick={() => void onRemoveBuddy(buddy.did)}
                  title="Remove buddy"
                >
                  &times;
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
