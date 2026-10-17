import { AuthContext } from '@/features/auth/authContext';
import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { type StaffAccount } from '@/shared/api/types';
import { nativeKitchenAction } from '@/features/kitchen/nativeKitchen';

export function StaffAuth() {
  const [user, setUser] = useState<StaffAccount | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const invalidate = useCallback(() => {
    nativeKitchenAction('logout');
    setUser(null);
  }, []);
  const reload = useCallback(async () => {
    try {
      setUser(await api<StaffAccount>('/auth/me'));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    api<StaffAccount>('/auth/me', { signal: controller.signal })
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((e) => {
        if (alive && !(e instanceof ApiError && e.status === 401)) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    window.addEventListener('staff-session-expired', invalidate);
    return () => {
      alive = false;
      controller.abort();
      window.removeEventListener('staff-session-expired', invalidate);
    };
  }, [invalidate]);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    invalidate();
  };
  return (
    <AuthContext.Provider value={{ user, loading, error, setUser, reload, invalidate, logout }}>
      <Outlet />
    </AuthContext.Provider>
  );
}
