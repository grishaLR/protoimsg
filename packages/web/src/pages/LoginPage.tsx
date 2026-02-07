import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoginForm } from '../components/auth/LoginForm';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { did, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (did) void navigate('/', { replace: true });
  }, [did, navigate]);

  if (isLoading) return <div className={styles.loading}>Loading...</div>;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Chatmosphere</h1>
      <p className={styles.subtitle}>AIM-inspired chat on the AT Protocol</p>
      <LoginForm />
    </div>
  );
}
