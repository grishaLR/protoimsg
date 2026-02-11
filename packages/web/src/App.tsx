import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { ConnectingScreen } from './components/auth/ConnectingScreen';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import styles from './App.module.css';

// Set by login() before redirect, cleared by init() after processing.
// On a hard refresh this flag is absent → skip ConnectingScreen.
const isOAuthCallback = sessionStorage.getItem('protoimsg:oauth_pending') === '1';

// Lazy-loaded — these pull in the heavy provider + page dependency graphs.
// They stay out of the main bundle; ConnectingScreen triggers preloading via lib/preload.ts.
const AuthenticatedApp = lazy(() =>
  import('./AuthenticatedApp').then((m) => ({ default: m.AuthenticatedApp })),
);
const RoomDirectoryPage = lazy(() =>
  import('./pages/RoomDirectoryPage').then((m) => ({ default: m.RoomDirectoryPage })),
);
const ChatRoomPage = lazy(() =>
  import('./pages/ChatRoomPage').then((m) => ({ default: m.ChatRoomPage })),
);
const DmWindowPage = lazy(() =>
  import('./pages/DmWindowPage').then((m) => ({ default: m.DmWindowPage })),
);
const RoomDirectoryWindowPage = lazy(() =>
  import('./pages/RoomDirectoryWindowPage').then((m) => ({
    default: m.RoomDirectoryWindowPage,
  })),
);
const FeedWindowPage = lazy(() =>
  import('./pages/FeedWindowPage').then((m) => ({ default: m.FeedWindowPage })),
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
  const { did, authPhase, authError, logout } = useAuth();

  // No session, not loading — go to login
  if (authPhase === 'idle' && !did) return <Navigate to="/login" replace />;

  // Auth in progress
  if (authPhase !== 'ready' && authPhase !== 'idle') {
    // OAuth callback → full AIM "Sign On" experience
    if (isOAuthCallback) return <ConnectingScreen />;
    // Session restore (hard refresh) → just hold on teal background while init() runs
    return <div className={styles.screenFill} />;
  }

  // Error state
  if (authError) {
    return (
      <div className={styles.authErrorBox}>
        <p>{authError}</p>
        <button type="button" onClick={logout} className={styles.authErrorButton}>
          Back to login
        </button>
      </div>
    );
  }

  // Ready — render app with lazy providers
  const suspenseFallback = isOAuthCallback ? (
    <ConnectingScreen />
  ) : (
    <div className={styles.screenFill} />
  );
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
        path="/"
        element={
          <ProtectedRoute>
            <RoomDirectoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms/:id"
        element={
          <ProtectedRoute>
            <ChatRoomPage />
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
      <Route
        path="/rooms-directory"
        element={
          <ProtectedRoute>
            <RoomDirectoryWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/feed"
        element={
          <ProtectedRoute>
            <FeedWindowPage />
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
    </BrowserRouter>
  );
}
