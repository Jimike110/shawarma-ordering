import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, json } from './api';
import type { StaffAccount, Store } from './types';
import { Loading, Notice } from './ui';
import { MenuProvider } from './menu';
import { Kitchen } from './pages/Kitchen';
import { StoreReports } from './pages/Reports';

interface AuthValue {
  user: StaffAccount | null;
  loading: boolean;
  error: string;
  setUser: (u: StaffAccount | null) => void;
  reload: () => Promise<void>;
  invalidate: () => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function useAuth() {
  const a = useContext(AuthContext);
  if (!a) throw new Error('Missing staff authentication');
  return a;
}
export function StaffAuth() {
  const [user, setUser] = useState<StaffAccount | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const invalidate = useCallback(() => setUser(null), []);
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
function Login() {
  const { setUser } = useAuth();
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setUser(
        await api<StaffAccount>('/auth/login', {
          method: 'POST',
          body: json({ username, password }),
        }),
      );
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container login">
      <form className="panel login-card" onSubmit={submit}>
        <h1>Вход для сотрудников</h1>
        <p>Войдите под своей учётной записью.</p>
        <label>
          Логин
          <input
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={60}
            disabled={busy}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && <Notice>{error}</Notice>}
        <button className="button full" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <p className="fine-print">Забыли пароль? Обратитесь к владельцу.</p>
        <Link to="/">Меню для гостей</Link>
      </form>
    </main>
  );
}
export function PasswordForm({ required = false }: { required?: boolean }) {
  const { setUser, logout } = useAuth();
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmation) {
      setError('Новые пароли не совпадают.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const u = await api<StaffAccount>('/auth/change-password', {
        method: 'POST',
        body: json({ current_password: current, password }),
      });
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setUser(u);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container account-page">
      <form className="panel login-card" onSubmit={submit}>
        <h1>{required ? 'Задайте личный пароль' : 'Смена пароля'}</h1>
        <p>
          {required
            ? 'Временный пароль нужно заменить перед началом работы.'
            : 'После смены другие устройства будут отключены.'}
        </p>
        <label>
          {required ? 'Временный пароль' : 'Текущий пароль'}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Новый пароль
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={15}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <small>От 15 символов. Например, длинная фраза.</small>
        <label>
          Повторите новый пароль
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && <Notice>{error}</Notice>}
        {done && <Notice kind="success">Пароль изменён.</Notice>}
        <button className="button" disabled={busy}>
          Сохранить пароль
        </button>
        {!required && <Link to="/kitchen">Вернуться к работе</Link>}
        <button
          type="button"
          className="text-link"
          onClick={() => void logout().catch((e) => setError(errorMessage(e)))}
        >
          Выйти
        </button>
      </form>
    </main>
  );
}
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
export function StaffTop() {
  const { user, logout } = useAuth();
  const [error, setError] = useState('');
  return (
    <>
      <div className="staff-top">
        <Link to={user?.owner ? '/owner' : '/staff/choose'}>{user?.display_name}</Link>
        <Link to="/staff/account">Пароль</Link>
        <button
          className="text-link"
          onClick={() => void logout().catch((e) => setError(errorMessage(e)))}
        >
          Выйти
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
const StoreContext = createContext<{ id: number; role: string; request: typeof api } | null>(null);
export function useStaffStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('Missing assigned store');
  return s;
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
    <StoreContext.Provider value={{ id, role, request }}>
      <MenuProvider key={id + ':' + user!.id} endpoint={'/staff/stores/' + id + '/menu'}>
        <div className="container">
          <StaffTop />
        </div>
        {reports ? <StoreReports /> : <Kitchen key={id + ':' + user!.id} />}
      </MenuProvider>
    </StoreContext.Provider>
  );
}
export function OwnerGate() {
  const { user } = useAuth();
  return user?.owner ? <Outlet /> : <Navigate to="/kitchen" replace />;
}
