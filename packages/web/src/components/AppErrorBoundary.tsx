import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sentry } from '../sentry';

function Fallback({ error, resetError }: { error: unknown; resetError: () => void }) {
  const { t } = useTranslation('common');
  const message = error instanceof Error ? error.message : t('errorBoundary.fallbackMessage');
  // Inline styles intentional — CSS modules may not be loaded in error state.
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--cm-desktop)',
        color: 'var(--cm-surface-content)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 'var(--cm-text-xl)', marginBottom: '1rem' }}>
        {t('errorBoundary.title')}
      </h1>
      <p style={{ marginBottom: '1rem' }}>{message}</p>
      <button
        type="button"
        onClick={resetError}
        style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
      >
        {t('errorBoundary.tryAgain')}
      </button>
    </div>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <Sentry.ErrorBoundary fallback={Fallback}>{children}</Sentry.ErrorBoundary>;
}
