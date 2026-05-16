import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ActorSearch, type ActorSearchResult } from '../shared/ActorSearch';
import styles from './ArcadeSignIn.module.css';

interface ArcadeSignInProps {
  onClose?: () => void;
}

export function ArcadeSignIn({ onClose: _onClose }: ArcadeSignInProps) {
  const { login } = useAuth();
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSelect(actor: ActorSearchResult) {
    setHandle(actor.handle);
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    sessionStorage.setItem('protoimsg:pending_games', '1');
    login(trimmed).catch((err: unknown) => {
      sessionStorage.removeItem('protoimsg:pending_games');
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setLoading(false);
    });
  }

  return (
    <div className={styles.content}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <ActorSearch
          value={handle}
          onInputChange={setHandle}
          onSelect={handleSelect}
          placeholder="handle or DID"
          clearOnSelect={false}
          variant="compact"
        />
        <button className={styles.btn} type="submit" disabled={loading || !handle.trim()}>
          {loading ? 'connecting...' : 'sign in →'}
        </button>
        {error && <div className={styles.error}>{error}</div>}
      </form>
      <div className={styles.note}>you'll land in protoimsg after signing in</div>
    </div>
  );
}
