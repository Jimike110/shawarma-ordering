import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  ChevronDown,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import { api, errorMessage } from './api';
import { useAuth } from './staff';
import { usePolling } from './usePolling';
import { Notice } from './ui';
import type { Store, IntakeBlocker } from './types';
import './owner.css';

type Workspace = {
  stores: Store[] | null;
  selected: string;
  visible: Store[];
  refresh: () => void;
  href: (path: string, extra?: Record<string, string>) => string;
  selectStore: (id: string, saved?: boolean) => void;
  setDirty: (key: symbol, dirty: boolean) => void;
};
const Context = createContext<Workspace | null>(null);
export function useOwnerWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing owner workspace');
  return value;
}
export function useOwnerDraft(dirty: boolean) {
  const { setDirty } = useOwnerWorkspace();
  const key = useRef(Symbol());
  useEffect(() => {
    setDirty(key.current, dirty);
    return () => setDirty(key.current, false);
  }, [dirty, setDirty]);
}
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
  const load = useCallback((signal: AbortSignal) => api<Store[]>('/owner/stores', { signal }), []);
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
    <Context.Provider
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
                  if (dirty && !window.confirm('Есть несохранённые данные. Выйти без сохранения?'))
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
    </Context.Provider>
  );
}

export function OwnerLoading() {
  return (
    <div className="owner-loading" role="status" aria-label="Загрузка">
      <span />
      <span />
      <span />
    </div>
  );
}
export function RefreshStatus({
  error,
  lastUpdated,
  refresh,
}: {
  error: string;
  lastUpdated: Date | null;
  refresh: () => void;
}) {
  if (!error) return null;
  return (
    <div className="owner-refresh">
      <Notice>
        {error}
        {lastUpdated && (
          <>
            {' '}
            Показаны данные на{' '}
            {lastUpdated.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК; они могут
            быть устаревшими.
          </>
        )}
      </Notice>
      <button className="button secondary small" onClick={refresh}>
        <RefreshCw size={15} />
        Повторить
      </button>
    </div>
  );
}
export function ActionMenu({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={ref}
      className={'owner-actions ' + className}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        {label}
        <ChevronDown size={15} />
      </summary>
      <div
        className="owner-action-popover"
        onClick={(e) => {
          if ((e.target as Element).closest('button,a')) {
            ref.current?.removeAttribute('open');
            ref.current?.querySelector('summary')?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
export const blockerLabels: Record<IntakeBlocker, string> = {
  archived: 'В архиве',
  unpublished: 'Черновик · не опубликована',
  privacy_unpublished: 'Не опубликованы документы оператора',
  owner_stopped: 'Стоп владельца',
  paused: 'Пауза кухни',
  outside_hours: 'Вне часов работы',
};
export function IntakeState({ store, full = false }: { store: Store; full?: boolean }) {
  const blockers = store.intake_blockers ?? [];
  return (
    <div className="owner-intake">
      <span className={'owner-state ' + (store.accepting_orders ? 'is-open' : 'is-closed')}>
        {store.accepting_orders
          ? 'Принимает заказы'
          : blockers.length
            ? blockerLabels[blockers[0]]
            : store.intake_message}
      </span>
      {full && blockers.length > 1 && (
        <ul>
          {blockers.slice(1).map((b) => (
            <li key={b}>{blockerLabels[b]}</li>
          ))}
        </ul>
      )}
      {full && store.owner_stopped && store.stop_reason && (
        <small>Причина: {store.stop_reason}</small>
      )}
      {full && store.settings.paused && store.settings.pause_message && (
        <small>Кухня: {store.settings.pause_message}</small>
      )}
    </div>
  );
}
