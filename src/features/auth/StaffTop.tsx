import { useAuth } from '@/features/auth/authContext';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/shared/api/client';
import { Notice } from '@/shared/ui/Feedback';

export function StaffTop() {
  const { user, logout } = useAuth();
  const [error, setError] = useState('');
  return (
    <>
      <div className="staff-top">
        <Link to={user?.owner ? '/owner' : '/staff/choose'}>{user?.display_name}</Link>
        {user?.account_type !== 'kitchen' && <Link to="/staff/account">Пароль</Link>}
        <button
          className="text-link"
          onClick={() => void logout().catch((e) => setError(errorMessage(e)))}
        >
          {user?.account_type === 'kitchen' ? 'Выйти / сменить точку' : 'Выйти'}
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
