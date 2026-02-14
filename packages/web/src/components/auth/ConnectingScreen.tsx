import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import type { AuthPhase } from '../../contexts/AuthContext';
import { claimDialup } from '../../lib/sounds';
import { preloadApp } from '../../lib/preload';
import styles from './ConnectingScreen.module.css';

interface DisplayStep {
  labelKey: string;
  status: 'done' | 'active' | 'pending';
}

const STEP_LABEL_KEYS = [
  'connecting.step.connecting',
  'connecting.step.verifying',
  'connecting.step.connectingToService',
  'connecting.step.loadingBuddies',
] as const;

/** Maps authPhase to the minimum step index that should be active */
function phaseToStepIndex(phase: AuthPhase): number {
  switch (phase) {
    case 'initializing':
    case 'authenticating':
      return 0;
    case 'resolving':
      return 1;
    case 'connecting':
      return 2;
    case 'ready':
      return 3;
    default:
      return 0;
  }
}

const MIN_STEP_MS = 1000;

export function ConnectingScreen() {
  const { t } = useTranslation('auth');
  const { authPhase, logout } = useAuth();
  const [displayIndex, setDisplayIndex] = useState(0);
  const [done, setDone] = useState(false);
  const lastAdvanceTime = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt the already-running dialup (started at module load) or start fresh.
  // Cleanup stops the audio on unmount.
  useEffect(() => claimDialup(), []);

  // Trigger preloads on mount
  useEffect(() => {
    preloadApp();
  }, []);

  // Advance displayIndex to match authPhase, respecting minimum display time
  useEffect(() => {
    const targetIndex = phaseToStepIndex(authPhase);

    function advance() {
      setDisplayIndex((current) => {
        if (current >= targetIndex) return current;
        const elapsed = Date.now() - lastAdvanceTime.current;
        if (elapsed >= MIN_STEP_MS) {
          lastAdvanceTime.current = Date.now();
          const next = current + 1;
          // If still behind target, schedule another advance
          if (next < targetIndex) {
            timerRef.current = setTimeout(advance, MIN_STEP_MS);
          }
          return next;
        }
        // Not enough time elapsed — schedule the remaining wait
        timerRef.current = setTimeout(advance, MIN_STEP_MS - elapsed);
        return current;
      });
    }

    advance();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [authPhase]);

  // After reaching last step AND authPhase is ready, wait minimum then signal done
  useEffect(() => {
    if (authPhase !== 'ready' || displayIndex < STEP_LABEL_KEYS.length - 1) return;

    const elapsed = Date.now() - lastAdvanceTime.current;
    const remaining = Math.max(0, MIN_STEP_MS - elapsed);
    const timer = setTimeout(() => {
      setDone(true);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [authPhase, displayIndex]);

  const handleCancel = useCallback(() => {
    // Audio cleanup happens via effect teardown when component unmounts after logout
    logout();
  }, [logout]);

  // Once done, render nothing — parent will show the app
  if (done && authPhase === 'ready') return null;

  const steps: DisplayStep[] = STEP_LABEL_KEYS.map((labelKey, i) => ({
    labelKey,
    status: i < displayIndex ? 'done' : i === displayIndex ? 'active' : 'pending',
  }));

  return (
    <div className={styles.backdrop}>
      <div className={styles.window}>
        <div className={styles.titleBar}>
          <span className={styles.titleText}>{t('connecting.titleBar')}</span>
        </div>
        <div className={styles.body}>
          <div className={styles.logo}>{t('connecting.logo')}</div>
          <div className={styles.steps}>
            {steps.map((step) => (
              <div
                key={step.labelKey}
                className={
                  step.status === 'done'
                    ? styles.stepDone
                    : step.status === 'active'
                      ? styles.stepActive
                      : styles.stepPending
                }
              >
                <span>
                  {step.status === 'done'
                    ? '\u2713'
                    : step.status === 'active'
                      ? '\u25B6'
                      : '\u25CB'}
                </span>
                <span>{t(step.labelKey as 'connecting.step.connecting')}</span>
              </div>
            ))}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} />
          </div>
          <button className={styles.cancelButton} onClick={handleCancel} type="button">
            {t('connecting.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
