import { useState } from 'react';
import styles from '../VideoCallOverlay.module.css';

/** First-run prompt asking the user for a display name before joining the call. */
export function NamePrompt({
  onJoin,
  onSkip,
}: {
  onJoin: (name: string) => void;
  onSkip: () => void;
}) {
  const [nameInput, setNameInput] = useState('');

  const submit = () => {
    const name = nameInput.trim();
    if (name) onJoin(name);
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="text"
        value={nameInput}
        onChange={(e) => {
          setNameInput(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Your display name"
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--cm-chrome-hover)',
          background: 'var(--cm-surface-button)',
          color: 'var(--cm-chrome-text)',
          fontSize: 'var(--cm-text-base)',
          outline: 'none',
        }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className={styles.controlBtn}
          onClick={submit}
          style={{ flex: 1, borderRadius: 6, width: 'auto', height: 28 }}
        >
          Join
        </button>
        <button
          className={styles.controlBtn}
          onClick={onSkip}
          style={{ flex: 1, borderRadius: 6, width: 'auto', height: 28, opacity: 0.6 }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
