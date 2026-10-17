import { OwnerContext } from '@/features/owner/ownerContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  LayoutDashboard,
  MapPin,
  Users,
  ChartNoAxesCombined,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import { api, errorMessage } from '@/shared/api/client';
import { useAuth } from '@/features/auth/authContext';
import { usePolling } from '@/shared/hooks/usePolling';
import { Notice } from '@/shared/ui/Feedback';
import { type Store } from '@/shared/api/types';
import '@/features/owner/owner.css';
import { OwnerLoading, ActionMenu, RefreshStatus } from '@/features/owner/OwnerUi';

const destinations = [
  { path: '/owner', label: 'Обзор', icon: LayoutDashboard },
  { path: '/owner/stores', label: 'Точки', icon: MapPin },
  { path: '/owner/staff', label: 'Сотрудники', icon: Users },
  { path: '/owner/analytics', label: 'Аналитика', icon: ChartNoAxesCombined },
];

export function OwnerLayout() {
  const { user, logout } = useAuth();
  const location = useLocation(),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get('store_id') ?? '';
  const load = useCallback(
    (signal: AbortSignal) => api<Store[]>('/owner/stores', { signal }),
    [],
  );
  const q = usePolling(load, 15000);
  const [warning, setWarning] = useState(''),
    [error, setError] = useState('');
  const createdSelection = useRef<{ id: string; since: Date } | null>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<symbol>>(() => new Set());
  const setDirty = useCallback(
    (key: symbol, dirty: boolean) =>
      setDirtyKeys((old) => {
        if (old.has(key) === dirty) return old;
        const next = new Set(old);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );
  const dirty = dirtyKeys.size > 0;
  const allowNext = useRef(false);
  const blocker = useBlocker(() => dirty && !allowNext.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Есть несохранённые данные. Покинуть страницу и потерять изменения?'))
      blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty],
    ),
  );
  useEffect(() => {
    if (q.data && selected && !q.data.some((s) => String(s.id) === selected)) {
      if (
        createdSelection.current?.id === selected &&
        (!q.lastUpdated || q.lastUpdated <= createdSelection.current.since)
      )
        return;
      const next = new URLSearchParams(params);
      next.delete('store_id');
      next.delete('before');
      setWarning('Выбранная точка недоступна. Показаны все точки.');
      setParams(next, { replace: true });
    }
  }, [q.data, q.lastUpdated, selected, params, setParams]);
  const href = (path: string, extra: Record<string, string> = {}) => {
    const next = new URLSearchParams({ ...(selected ? { store_id: selected } : {}), ...extra });
    return path + (next.size ? '?' + next : '');
  };
  function selectStore(id: string, saved = false) {
    const next = new URLSearchParams(params);
    next.delete('before');
    if (id) next.set('store_id', id);
    else next.delete('store_id');
    allowNext.current = saved;
    if (saved) createdSelection.current = { id, since: new Date() };
    setParams(next);
    allowNext.current = false;
  }
  const title =
    location.pathname === '/owner/privacy'
      ? 'Персональные данные'
      : (destinations.find((d) => d.path === location.pathname)?.label ?? 'Обзор');
  useEffect(() => {
    document.title = title + ' · Управление бизнесом';
  }, [title]);
  const nav = (
    <nav className="owner-primary" aria-label="Разделы владельца">
      {destinations.map((d) => (
        <NavLink end={d.path === '/owner'} key={d.path} to={href(d.path)}>
          <d.icon size={20} />
          <span>{d.label}</span>
        </NavLink>
      ))}
    </nav>
  );
  return (
    <OwnerContext.Provider
      value={{
        stores: q.data,
        selected,
        visible: (q.data ?? []).filter((s) => !selected || String(s.id) === selected),
        refresh: q.refresh,
        href,
        selectStore,
        setDirty,
      }}
    >
      <div className="owner-shell" key={user!.id}>
        <a className="skip-link" href="#owner-content">
          К содержимому
        </a>
        <aside className="owner-sidebar">
          <Link to={href('/owner')} className="owner-brand">
            <span className="owner-brand-mark">Я</span>
            <span>
              Управление<small>Бизнес и точки</small>
            </span>
          </Link>
          {nav}
          <div className="owner-secondary">
            <NavLink to={href('/owner/privacy')}>
              <ShieldCheck size={19} />
              Персональные данные
            </NavLink>
            <a href="/" target="_blank" rel="noreferrer">
              Страница для гостей <ArrowUpRight size={16} />
            </a>
          </div>
        </aside>
        <div className="owner-main">
          <header className="owner-header">
            <div className="owner-header-title">
              <span>Управление бизнесом</span>
              <strong>{title}</strong>
            </div>
            <label className="owner-store-select">
              Точка
              <select
                aria-label="Точка"
                value={selected}
                disabled={!q.data}
                onChange={(e) => selectStore(e.target.value)}
              >
                <option value="">Все точки</option>
                {q.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.settings.address || s.settings.shop_name}
                    {s.archived ? ' · архив' : ''}
                  </option>
                ))}
              </select>
            </label>
            <ActionMenu label="Аккаунт" className="owner-account">
              <p>
                {user!.display_name}
                <small>Владелец · все точки</small>
              </p>
              <Link to={href('/owner/privacy')}>Персональные данные</Link>
              <Link to="/staff/account">Сменить пароль</Link>
              <button
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm('Есть несохранённые данные. Выйти без сохранения?')
                  )
                    return;
                  void logout()
                    .then(() => navigate('/kitchen'))
                    .catch((e) => setError(errorMessage(e)));
                }}
              >
                Выйти
              </button>
            </ActionMenu>
          </header>
          <main id="owner-content" className="owner-content">
            {warning && <Notice kind="warning">{warning}</Notice>}
            {error && <Notice>{error}</Notice>}
            <RefreshStatus error={q.error} lastUpdated={q.lastUpdated} refresh={q.refresh} />
            {!q.data ? (
              q.error ? null : (
                <OwnerLoading />
              )
            ) : (
              <div
                key={
                  user!.id +
                  ':' +
                  location.pathname +
                  ':' +
                  selected +
                  (location.pathname === '/owner/privacy'
                    ? ':' + (params.get('section') ?? 'documents')
                    : '')
                }
              >
                <Outlet />
              </div>
            )}
          </main>
        </div>
        <div className="owner-mobile-nav">{nav}</div>
      </div>
    </OwnerContext.Provider>
  );
}
