import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { SignupForm } from '../components/auth/SignupForm';
import styles from './LoginPage.module.css';

export function SignupPage() {
  const { did } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (did) void navigate('/', { replace: true });
  }, [did, navigate]);

  return (
    <div className={styles.container}>
      <SignupForm />
    </div>
  );
}
