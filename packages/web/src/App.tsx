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
import { PUBLIC_ARCADE_ENABLED, SIGNUP_ENABLED } from './lib/config';
import styles from './App.module.css';

// Set by login() before redirect, cleared by init() after processing.
// On a hard refresh this flag is absent → skip ConnectingScreen.
const isOAuthCallback = sessionStorage.getItem('protoimsg:oauth_pending') === '1';

// Clear stale-chunk reload flag on successful page load
sessionStorage.removeItem('protoimsg:chunk_reload');

// Auto-reload on stale chunks after a deploy (old hashed filenames → 404).
// Prevents "Failed to fetch dynamically imported module" / "Unable to preload CSS" errors.
function reloadOnChunkError<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown): Promise<T> => {
    const key = 'protoimsg:chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
      // Reload is imminent — return a never-settling promise so the Suspense
      // fallback stays up. Re-throwing here would flash the ErrorBoundary and
      // report a Sentry event for what is just a stale-deploy artifact.
      return new Promise<T>(() => {});
    }
    // Already reloaded once and it still failed — a genuine error. Surface it.
    throw err;
  });
}

// Lazy-loaded — these pull in the heavy provider + page dependency graphs.
// They stay out of the main bundle; ConnectingScreen triggers preloading via lib/preload.ts.
const AuthenticatedApp = lazy(() =>
  reloadOnChunkError(import('./AuthenticatedApp').then((m) => ({ default: m.AuthenticatedApp }))),
);
const HomePage = lazy(() =>
  reloadOnChunkError(import('./pages/HomePage').then((m) => ({ default: m.HomePage }))),
);
const DmWindowPage = lazy(() =>
  reloadOnChunkError(import('./pages/DmWindowPage').then((m) => ({ default: m.DmWindowPage }))),
);
const VideoCallWindowPage = lazy(() =>
  reloadOnChunkError(
    import('./pages/VideoCallWindowPage').then((m) => ({ default: m.VideoCallWindowPage })),
  ),
);
const ProfileWindowPage = lazy(() =>
  reloadOnChunkError(
    import('./pages/ProfileWindowPage').then((m) => ({ default: m.ProfileWindowPage })),
  ),
);
const PublicArcadePage = lazy(() =>
  reloadOnChunkError(
    import('./pages/PublicArcadePage').then((m) => ({ default: m.PublicArcadePage })),
  ),
);
const MeetWindowPage = lazy(() =>
  reloadOnChunkError(import('./pages/MeetWindowPage').then((m) => ({ default: m.MeetWindowPage }))),
);
const BotWindowPage = lazy(() =>
  reloadOnChunkError(import('./pages/BotWindowPage').then((m) => ({ default: m.BotWindowPage }))),
);
/** /meet/:callId — saves the meet code so it survives OAuth, then redirects to /. */
function MeetRedirect() {
  const { callId } = useParams<{ callId: string }>();
  if (callId) {
    sessionStorage.setItem('protoimsg:pending_meet_code', callId);
  }
  return <Navigate to="/" replace />;
}
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
            <HomePage />
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
      <Route
        path="/profile/:did"
        element={
          <ProtectedRoute>
            <ProfileWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/games"
        element={
          PUBLIC_ARCADE_ENABLED ? (
            <Suspense fallback={null}>
              <PublicArcadePage />
            </Suspense>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/meet-window"
        element={
          <ProtectedRoute>
            <MeetWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/meet-window/:meetCode"
        element={
          <ProtectedRoute>
            <MeetWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bot"
        element={
          <ProtectedRoute>
            <BotWindowPage />
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
