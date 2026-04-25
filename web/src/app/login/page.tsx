import { Suspense } from 'react';
import LoginForm from '@/components/auth/LoginForm';

export const metadata = {
  title: 'Sign in — FinAdviser',
};

export default function LoginPage() {
  // useSearchParams in LoginForm requires a Suspense boundary in the
  // server-component tree.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
