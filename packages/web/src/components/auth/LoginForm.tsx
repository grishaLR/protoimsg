import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useRotatingPlaceholder } from '../../hooks/useRotatingPlaceholder';
import { useTurnstile } from '../../hooks/useTurnstile';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import {
  AccountBannedError,
  NotOnAllowlistError,
  CaptchaFailedError,
  joinWaitlist,
} from '../../lib/api';
import { SIGNUP_ENABLED } from '../../lib/config';
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
  const [notOnAllowlist, setNotOnAllowlist] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const placeholder = useRotatingPlaceholder('login');
  const turnstile = useTurnstile();

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;

    setError(null);
    setBanned(false);
    setNotOnAllowlist(false);
    setLoading(true);
    login(trimmed, turnstile.getToken() ?? undefined).catch((err: unknown) => {
      if (err instanceof NotOnAllowlistError) {
        setNotOnAllowlist(true);
      } else if (err instanceof AccountBannedError) {
        setBanned(true);
      } else if (err instanceof CaptchaFailedError) {
        setError(t('login.error.captchaFailed'));
        turnstile.reset();
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
        <div className={styles.betaSignupBox}>
          <h2 className={styles.betaSignupTitle}>{t('login.banned.title')}</h2>
          <p className={styles.betaSignupBody}>{t('login.banned.body')}</p>
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              setBanned(false);
            }}
          >
            {t('login.betaSignup.back')}
          </button>
        </div>
      </div>
    );
  }

  if (notOnAllowlist) {
    return (
      <BetaSignupForm
        handle={handle}
        onBack={() => {
          setNotOnAllowlist(false);
        }}
      />
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
          placeholder={placeholder}
          variant="default"
          disabled={loading}
          autoFocus
        />
        {turnstile.enabled && <div ref={turnstile.containerRef} className={styles.captcha} />}
        {error && <p className={styles.error}>{error}</p>}
        <button
          className={styles.button}
          type="submit"
          disabled={loading || !handle.trim() || (turnstile.enabled && !turnstile.ready)}
        >
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
        {SIGNUP_ENABLED && (
          <Link to="/signup" className={styles.infoLink}>
            {t('login.createAccount')}
          </Link>
        )}
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

export function BetaSignupForm({ handle, onBack }: { handle: string; onBack: () => void }) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [handleValue, setHandleValue] = useState(handle);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholder = useRotatingPlaceholder('login');

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    // Basic client-side email check
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setError(t('login.betaSignup.error.invalid'));
      return;
    }

    setError(null);
    setSubmitting(true);
    joinWaitlist(trimmedEmail, handleValue.trim())
      .then(() => {
        setSuccess(true);
      })
      .catch(() => {
        setError(t('login.betaSignup.error.default'));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  return (
    <div className={styles.form}>
      <h1 className={styles.title}>{t('login.title')}</h1>
      <div className={styles.betaSignupBox}>
        <h2 className={styles.betaSignupTitle}>{t('login.betaSignup.title')}</h2>
        <p className={styles.betaSignupBody}>{t('login.betaSignup.body')}</p>
        {success ? (
          <>
            <p className={styles.betaSignupSuccess}>{t('login.betaSignup.success')}</p>
            <button className={styles.button} type="button" onClick={onBack}>
              {t('login.betaSignup.back')}
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className={styles.betaSignupBox}>
              <label className={styles.betaSignupLabel} htmlFor="waitlist-email">
                {t('login.betaSignup.emailLabel')}
              </label>
              <input
                id="waitlist-email"
                className={styles.betaSignupInput}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder={t('login.betaSignup.emailPlaceholder')}
                required
                autoFocus
              />
              <label className={styles.betaSignupLabel} htmlFor="waitlist-handle">
                {t('login.betaSignup.handleLabel')}
              </label>
              <input
                id="waitlist-handle"
                className={styles.betaSignupInput}
                type="text"
                value={handleValue}
                onChange={(e) => {
                  setHandleValue(e.target.value);
                }}
                placeholder={handle || placeholder}
                required
              />
              {error && <p className={styles.error}>{error}</p>}
              <button
                className={styles.button}
                type="submit"
                disabled={submitting || !email.trim() || !handleValue.trim()}
              >
                {submitting ? t('login.betaSignup.submitting') : t('login.betaSignup.submit')}
              </button>
              <button className={styles.button} type="button" onClick={onBack}>
                {t('login.betaSignup.back')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
