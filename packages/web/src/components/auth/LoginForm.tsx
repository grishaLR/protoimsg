import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { AtprotoInfoModal } from './AtprotoInfoModal';
import styles from './LoginForm.module.css';

export function LoginForm() {
  const { login } = useAuth();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;

    setError(null);
    setLoading(true);
    login(trimmed).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    });
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>chatmosphere</h1>
        <p className={styles.subtitle}>AIM-inspired chat on the AT Protocol</p>
        <label className={styles.label} htmlFor="handle">
          atproto handle
        </label>
        <input
          id="handle"
          className={styles.input}
          type="text"
          placeholder="you.your-server.com"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
          }}
          disabled={loading}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="submit" disabled={loading || !handle.trim()}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <button
          className={styles.infoLink}
          type="button"
          onClick={() => {
            setShowInfo(true);
          }}
        >
          New to atproto? Learn more
        </button>
      </form>
      {showInfo && (
        <AtprotoInfoModal
          onClose={() => {
            setShowInfo(false);
          }}
        />
      )}
    </>
  );
}
