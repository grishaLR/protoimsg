import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { ConnectingScreen } from './components/auth/ConnectingScreen';
import { AppErrorBoundary } from './components/AppErrorBoundary';

// Set by login() before redirect, cleared by init() after processing.
// On a hard refresh this flag is absent → skip ConnectingScreen.
const isOAuthCallback = sessionStorage.getItem('chatmosphere:oauth_pending') === '1';

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
    return <div style={{ minHeight: '100vh', background: 'var(--cm-desktop)' }} />;
  }

  // Error state
  if (authError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>{authError}</p>
        <button onClick={logout} style={{ marginTop: '1rem' }}>
          Back to login
        </button>
      </div>
    );
  }

  // Ready — render app with lazy providers
  const suspenseFallback = isOAuthCallback ? (
    <ConnectingScreen />
  ) : (
    <div style={{ minHeight: '100vh', background: 'var(--cm-desktop)' }} />
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
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <AppRoutes />
          </QueryClientProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
