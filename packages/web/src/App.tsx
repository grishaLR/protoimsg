import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { RoomDirectoryPage } from './pages/RoomDirectoryPage';
import { ChatRoomPage } from './pages/ChatRoomPage';
import { WebSocketProvider } from './contexts/WebSocketContext';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { did, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!did) return <Navigate to="/login" replace />;

  return <>{children}</>;
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
      <AuthProvider>
        <WebSocketProvider>
          <AppRoutes />
        </WebSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
