import { useAuth } from '@/features/auth/authContext';
import { Navigate, Outlet } from 'react-router-dom';
import { Loading, Notice } from '@/shared/ui/Feedback';
import { Login } from '@/features/auth/Login';
import { PasswordForm } from '@/features/auth/PasswordForm';

export function StaffGate() {
  const a = useAuth();
  if (a.loading) return <Loading />;
  if (a.error)
    return (
      <main className="container empty">
        <Notice>{a.error}</Notice>
        <button className="button" onClick={() => void a.reload()}>
          Повторить
        </button>
      </main>
    );
  if (!a.user) return <Login />;
  if (a.user.password_required) return <PasswordForm required />;
  return <Outlet />;
}

export function OwnerGate() {
  const { user } = useAuth();
  return user?.owner ? <Outlet /> : <Navigate to="/kitchen" replace />;
}
