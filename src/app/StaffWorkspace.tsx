import { useAuth } from '@/features/auth/authContext';
import { StaffStoreContext } from '@/features/auth/storeContext';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '@/shared/api/client';
import { type Store } from '@/shared/api/types';
import { Notice } from '@/shared/ui/Feedback';
import { MenuProvider } from '@/features/catalog/MenuProvider';
import { Kitchen } from '@/features/kitchen/Kitchen';
import { StoreReports } from '@/features/analytics/StoreReports';
import { StaffTop } from '@/features/auth/StaffTop';

export function StaffHome() {
  const { user } = useAuth();
  if (user?.owner) return <Navigate to="/owner" replace />;
  if (user?.memberships.length === 1)
    return <Navigate to={'/staff/stores/' + user.memberships[0].store_id} replace />;
  return <StaffStorePicker />;
}

export function StaffStorePicker() {
  const [stores, setStores] = useState<Store[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    api<Store[]>('/staff/stores', { signal: c.signal })
      .then(setStores)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, []);
  return (
    <main className="container">
      <StaffTop />
      <h1>Выберите точку</h1>
      {error && <Notice>{error}</Notice>}
      <div className="store-list">
        {stores.map((s) => (
          <Link className="panel store-card" to={'/staff/stores/' + s.id} key={s.id}>
            <h2>{s.settings.shop_name}</h2>
            <p>{s.settings.address}</p>
            <span>
              {s.role === 'manager' ? 'Управляющий' : 'Сотрудник'} · {s.intake_message}
            </span>
          </Link>
        ))}
      </div>
      {!stores.length && !error && <p>Нет назначенных точек. Обратитесь к владельцу.</p>}
    </main>
  );
}

export function StoreWorkspace({ reports = false }: { reports?: boolean }) {
  const { storeId } = useParams();
  const { user } = useAuth();
  const id = Number(storeId),
    role = user?.owner ? 'owner' : user?.memberships.find((m) => m.store_id === id)?.role;
  const request = useCallback(
    <T,>(path: string, options: RequestInit = {}) =>
      api<T>('/staff/stores/' + id + path.replace(/^\/kitchen/, ''), options),
    [id],
  );
  if (!Number.isSafeInteger(id) || id < 1 || !role)
    return (
      <main className="container empty">
        <Notice>У вас нет доступа к этой точке.</Notice>
        <Link to="/kitchen">Вернуться</Link>
      </main>
    );
  if (reports && role === 'worker') return <Navigate to={'/staff/stores/' + id} replace />;
  return (
    <StaffStoreContext.Provider value={{ id, role, request }}>
      <MenuProvider key={id + ':' + user!.id} endpoint={'/staff/stores/' + id + '/menu'}>
        {reports ? (
          <>
            <div className="container">
              <StaffTop />
            </div>
            <StoreReports />
          </>
        ) : (
          <Kitchen key={id + ':' + user!.id} accountMenu={<StaffTop />} />
        )}
      </MenuProvider>
    </StaffStoreContext.Provider>
  );
}
