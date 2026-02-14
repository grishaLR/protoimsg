import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import { AccountBannedError } from '../../lib/api';
import { ActorSearch, type ActorSearchResult } from '../shared/ActorSearch';
import { AtprotoInfoModal } from './AtprotoInfoModal';
import { LanguageSelector } from '../settings/LanguageSelector';
import styles from './LoginForm.module.css';

export function LoginForm() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
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
        setError(err instanceof Error ? err.message : t('login.error.default'));
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
        <h1 className={styles.title}>{t('login.title')}</h1>
        <div className={styles.bannedBox}>
          <p className={styles.bannedHandle}>{handle}</p>
          <p className={styles.bannedMessage}>{t('login.banned.message')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>{t('login.title')}</h1>
        <p className={styles.subtitle}>{t('login.subtitle')}</p>
        <label className={styles.label} htmlFor="handle">
          {t('login.handleLabel')}
        </label>
        <ActorSearch
          id="handle"
          value={handle}
          onInputChange={setHandle}
          onSelect={handleActorSelect}
          clearOnSelect={false}
          placeholder={t('login.handlePlaceholder')}
          variant="default"
          disabled={loading}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="submit" disabled={loading || !handle.trim()}>
          {loading ? t('login.submitLoading') : t('login.submit')}
        </button>
        <button
          className={styles.infoLink}
          type="button"
          onClick={() => {
            setShowInfo(true);
          }}
        >
          {t('login.learnMore')}
        </button>
        <div className={styles.selectors}>
          <label className={styles.selectorLabel}>
            {t('login.theme')}
            <select
              className={styles.themeSelect}
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value as Theme);
              }}
            >
              {THEME_OPTIONS.map((themeOpt) => (
                <option key={themeOpt.id} value={themeOpt.id}>
                  {tc(themeOpt.labelKey as 'theme.aim')}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.selectorLabel}>
            {t('login.language')}
            <LanguageSelector />
          </label>
        </div>
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
