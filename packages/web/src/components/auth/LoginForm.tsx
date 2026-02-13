import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import { AccountBannedError } from '../../lib/api';
import { ActorSearch, type ActorSearchResult } from '../shared/ActorSearch';
import { AtprotoInfoModal } from './AtprotoInfoModal';
import styles from './LoginForm.module.css';

export function LoginForm() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;

    setError(null);
    setBanned(false);
    setLoading(true);
    login(trimmed).catch((err: unknown) => {
      if (err instanceof AccountBannedError) {
        setBanned(true);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
      setLoading(false);
    });
  }

  function handleActorSelect(actor: ActorSearchResult) {
    setHandle(actor.handle);
  }

  if (banned) {
    return (
      <div className={styles.form}>
        <h1 className={styles.title}>proto instant messenger</h1>
        <div className={styles.bannedBox}>
          <p className={styles.bannedHandle}>{handle}</p>
          <p className={styles.bannedMessage}>This account is not permitted to use this service.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>proto instant messenger</h1>
        <p className={styles.subtitle}>community chats on the AT Protocol</p>
        <label className={styles.label} htmlFor="handle">
          atproto handle
        </label>
        <ActorSearch
          id="handle"
          value={handle}
          onInputChange={setHandle}
          onSelect={handleActorSelect}
          clearOnSelect={false}
          placeholder="you.your-server.com"
          variant="default"
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
        <select
          className={styles.themeSelect}
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value as Theme);
          }}
        >
          {THEME_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
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
