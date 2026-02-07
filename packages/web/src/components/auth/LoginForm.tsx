import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './LoginForm.module.css';

export function LoginForm() {
  const { login } = useAuth();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="handle">
        Bluesky Handle
      </label>
      <input
        id="handle"
        className={styles.input}
        type="text"
        placeholder="you.bsky.social"
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
    </form>
  );
}
