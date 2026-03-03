import { Redirect } from 'expo-router';
import { useAuth } from '@/services/auth';
import LoginScreen from '@/components/LoginScreen';

export default function Index() {
  const { session, isLoading, authPhase } = useAuth();

  if (isLoading || authPhase === 'initializing') {
    return <LoginScreen />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <Redirect href="/(tabs)/buddy-list" />;
}
