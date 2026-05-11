import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import { createAccount, CaptchaFailedError, checkHandleAvailability } from '../../lib/api';
import { TURNSTILE_SITE_KEY } from '../../lib/config';
import { LanguageSelector } from '../settings/LanguageSelector';
import styles from './SignupForm.module.css';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const HANDLE_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$/;

const RESERVED_HANDLES = new Set([
  'admin',
  'support',
  'help',
  'mod',
  'moderator',
  'team',
  'staff',
  'protoimsg',
  'system',
  'root',
  'api',
  'pds',
  'www',
  'mail',
  'blog',
  'app',
  'dev',
]);

type HandleStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved';

export function SignupForm() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const { theme, setTheme } = useTheme();

  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [handleStatus, setHandleStatus] = useState<HandleStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(!TURNSTILE_SITE_KEY);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileTokenRef = useRef<string | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  const fullHandle = handle ? `${handle}.protoimsg.app` : '';

  const validateHandle = useCallback((value: string) => {
    abortRef.current?.abort();
    clearTimeout(debounceRef.current);

    if (!value) {
      setHandleStatus('idle');
      return;
    }
    if (RESERVED_HANDLES.has(value.toLowerCase())) {
      setHandleStatus('reserved');
      return;
    }
    if (!HANDLE_REGEX.test(value)) {
      setHandleStatus('invalid');
      return;
    }
    setHandleStatus('checking');
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      checkHandleAvailability(`${value}.protoimsg.app`, controller.signal)
        .then((available) => {
          if (!controller.signal.aborted) {
            setHandleStatus(available ? 'available' : 'taken');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setHandleStatus('idle');
          }
        });
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Load Turnstile script and render widget
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;

    const container = turnstileRef.current;
    const siteKey = TURNSTILE_SITE_KEY;
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !window.turnstile) return;
      turnstileWidgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => {
          turnstileTokenRef.current = token;
          setTurnstileReady(true);
        },
        'expired-callback': () => {
          turnstileTokenRef.current = null;
          setTurnstileReady(false);
          setError(t('signup.captcha.expired'));
        },
        'error-callback': () => {
          turnstileTokenRef.current = null;
          setTurnstileReady(false);
          setError(t('signup.captcha.failed'));
        },
        theme: 'auto',
      });
    }

    const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

    // If script already loaded, render immediately
    if (window.turnstile) {
      renderWidget();
    } else if (!document.getElementById(TURNSTILE_SCRIPT_ID)) {
      // Load the script (only if not already injected by a previous mount)
      const script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, []);

  function handleHandleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setHandle(value);
    validateHandle(value);
  }

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const dobTooYoung = (() => {
    if (!dob) return false;
    const birth = new Date(dob + 'T00:00:00');
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age < 16;
  })();

  const canSubmit =
    handle &&
    email &&
    dob &&
    !dobTooYoung &&
    password.length >= 8 &&
    password === confirmPassword &&
    tosAccepted &&
    handleStatus === 'available' &&
    turnstileReady &&
    !submitting;

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setSubmitting(true);

    createAccount({
      handle: fullHandle,
      email: email.trim(),
      password,
      dob,
      turnstileToken: turnstileTokenRef.current ?? undefined,
    })
      .then(() => {
        setSuccess(true);
      })
      .catch((err: unknown) => {
        if (err instanceof CaptchaFailedError) {
          setError(t('signup.captcha.failed'));
          // Reset the widget so user can try again
          turnstileTokenRef.current = null;
          setTurnstileReady(false);
          if (turnstileWidgetIdRef.current && window.turnstile) {
            window.turnstile.reset(turnstileWidgetIdRef.current);
          }
        } else {
          setError(err instanceof Error ? err.message : t('signup.error.default'));
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  if (success) {
    return (
      <div className={styles.form}>
        <h1 className={styles.title}>{t('login.title')}</h1>
        <div className={styles.successBox}>
          <h2 className={styles.successTitle}>{t('signup.success.title')}</h2>
          <p className={styles.successBody}>{t('signup.success.body')}</p>
          <p className={styles.successHandle}>@{fullHandle}</p>
          <Link to="/login" className={styles.button}>
            {t('signup.success.signIn')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h1 className={styles.title}>{t('login.title')}</h1>
      <p className={styles.subtitle}>{t('signup.subtitle')}</p>

      <div className={styles.pdsWarning} role="alert">
        {t('signup.pdsWarning')}
      </div>

      <label className={styles.label} htmlFor="signup-handle">
        {t('signup.handleLabel')}
      </label>
      <div className={styles.handleRow}>
        <input
          id="signup-handle"
          className={styles.handleInput}
          type="text"
          value={handle}
          onChange={handleHandleChange}
          placeholder={t('signup.handlePlaceholder')}
          maxLength={32}
          autoComplete="username"
          autoFocus
        />
        <span className={styles.handleSuffix}>.protoimsg.app</span>
      </div>
      {handleStatus === 'checking' && <p className={styles.hint}>{t('signup.handle.checking')}</p>}
      {handleStatus === 'available' && (
        <p className={styles.hintSuccess}>{t('signup.handle.available')}</p>
      )}
      {handleStatus === 'taken' && <p className={styles.error}>{t('signup.handle.taken')}</p>}
      {handleStatus === 'invalid' && <p className={styles.error}>{t('signup.handle.invalid')}</p>}
      {handleStatus === 'reserved' && <p className={styles.error}>{t('signup.handle.reserved')}</p>}

      <label className={styles.label} htmlFor="signup-email">
        {t('signup.emailLabel')}
      </label>
      <input
        id="signup-email"
        className={styles.input}
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        placeholder={t('signup.emailPlaceholder')}
        autoComplete="email"
        required
      />

      <label className={styles.label} htmlFor="signup-dob">
        {t('signup.dobLabel')}
      </label>
      <input
        id="signup-dob"
        className={styles.input}
        type="date"
        value={dob}
        onChange={(e) => {
          setDob(e.target.value);
        }}
        max={new Date().toISOString().split('T')[0]}
        required
      />
      <p className={styles.hint}>{t('signup.dobHint')}</p>
      {dobTooYoung && <p className={styles.error}>{t('signup.dobTooYoung')}</p>}

      <label className={styles.label} htmlFor="signup-password">
        {t('signup.passwordLabel')}
      </label>
      <input
        id="signup-password"
        className={styles.input}
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
        placeholder={t('signup.passwordPlaceholder')}
        autoComplete="new-password"
        minLength={8}
        required
      />
      {passwordTooShort && <p className={styles.error}>{t('signup.password.tooShort')}</p>}

      <label className={styles.label} htmlFor="signup-confirm-password">
        {t('signup.confirmPasswordLabel')}
      </label>
      <input
        id="signup-confirm-password"
        className={styles.input}
        type="password"
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
        }}
        placeholder={t('signup.confirmPasswordPlaceholder')}
        autoComplete="new-password"
        required
      />
      {passwordMismatch && <p className={styles.error}>{t('signup.password.mismatch')}</p>}

      <label className={styles.tosLabel}>
        <input
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => {
            setTosAccepted(e.target.checked);
          }}
        />
        <span>
          <Trans
            i18nKey="signup.tosLabel"
            ns="auth"
            components={{ a: <a href="/tos" target="_blank" rel="noopener noreferrer" /> }}
          />
        </span>
      </label>

      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className={styles.turnstile} />}

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.button} type="submit" disabled={!canSubmit}>
        {submitting ? t('signup.submitting') : t('signup.submit')}
      </button>

      <Link to="/login" className={styles.loginLink}>
        {t('signup.haveAccount')}
      </Link>

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
  );
}
