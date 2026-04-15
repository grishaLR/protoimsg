import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { ConnectingScreen } from './components/auth/ConnectingScreen';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppLoader } from './components/AppLoader';
import { SIGNUP_ENABLED } from './lib/config';
import styles from './App.module.css';

// Set by login() before redirect, cleared by init() after processing.
// On a hard refresh this flag is absent → skip ConnectingScreen.
const isOAuthCallback = sessionStorage.getItem('protoimsg:oauth_pending') === '1';

// Clear stale-chunk reload flag on successful page load
sessionStorage.removeItem('protoimsg:chunk_reload');

// Auto-reload on stale chunks after a deploy (old hashed filenames → 404).
// Prevents "Failed to fetch dynamically imported module" / "Unable to preload CSS" errors.
function reloadOnChunkError<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown): never => {
    const key = 'protoimsg:chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
    throw err;
  });
}

// Lazy-loaded — these pull in the heavy provider + page dependency graphs.
// They stay out of the main bundle; ConnectingScreen triggers preloading via lib/preload.ts.
const AuthenticatedApp = lazy(() =>
  reloadOnChunkError(import('./AuthenticatedApp').then((m) => ({ default: m.AuthenticatedApp }))),
);
const DmWindowPage = lazy(() =>
  reloadOnChunkError(import('./pages/DmWindowPage').then((m) => ({ default: m.DmWindowPage }))),
);
const VideoCallWindowPage = lazy(() =>
  reloadOnChunkError(
    import('./pages/VideoCallWindowPage').then((m) => ({ default: m.VideoCallWindowPage })),
  ),
);
/** /meet/:callId — saves the meet code so it survives OAuth, then redirects to /. */
function MeetRedirect() {
  const { callId } = useParams<{ callId: string }>();
  if (callId) {
    sessionStorage.setItem('protoimsg:pending_meet_code', callId);
  }
  return <Navigate to="/" replace />;
}
const BetaSignupPage = lazy(() =>
  reloadOnChunkError(import('./pages/BetaSignupPage').then((m) => ({ default: m.BetaSignupPage }))),
);
const SignupPage = lazy(() =>
  reloadOnChunkError(import('./pages/SignupPage').then((m) => ({ default: m.SignupPage }))),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('auth');
  const { did, authPhase, authError, logout } = useAuth();

  // No session, not loading — go to login
  if (authPhase === 'idle' && !did) return <Navigate to="/login" replace />;

  // Auth in progress
  if (authPhase !== 'ready' && authPhase !== 'idle') {
    // OAuth callback → full AIM "Sign On" experience
    if (isOAuthCallback) return <ConnectingScreen />;
    // Session restore (hard refresh) → show static nav shell while init() runs
    return <AppLoader />;
  }

  // Error state
  if (authError) {
    return (
      <div className={styles.authErrorBox}>
        <p>{authError}</p>
        <button type="button" onClick={logout} className={styles.authErrorButton}>
          {t('app.backToLogin')}
        </button>
      </div>
    );
  }

  // Ready — render app with lazy providers
  const suspenseFallback = isOAuthCallback ? <ConnectingScreen /> : <AppLoader />;
  return (
    <Suspense fallback={suspenseFallback}>
      <AuthenticatedApp>{children}</AuthenticatedApp>
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/beta-signup"
        element={
          <Suspense fallback={null}>
            <BetaSignupPage />
          </Suspense>
        }
      />
      <Route
        path="/signup"
        element={
          SIGNUP_ENABLED ? (
            <Suspense fallback={null}>
              <SignupPage />
            </Suspense>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DmWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dm/:conversationId"
        element={
          <ProtectedRoute>
            <DmWindowPage />
          </ProtectedRoute>
        }
      />
      <Route path="/meet/:callId" element={<MeetRedirect />} />
      <Route
        path="/videocall/:conversationId"
        element={
          <ProtectedRoute>
            <VideoCallWindowPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AppErrorBoundary>
          <AuthProvider>
            <QueryClientProvider client={queryClient}>
              <AppRoutes />
            </QueryClientProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </ThemeProvider>
      <Analytics />
    </BrowserRouter>
  );
}
