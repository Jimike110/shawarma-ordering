import { useAuth } from '@/features/auth/authContext';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, errorMessage, json } from '@/shared/api/client';
import { type StaffAccount } from '@/shared/api/types';
import { Notice } from '@/shared/ui/Feedback';
import { nativeKitchenAction } from '@/features/kitchen/nativeKitchen';
import { prepareKitchenAudio } from '@/features/kitchen/kitchenAudio';

export function Login() {
  const { setUser } = useAuth();
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('Кухня');
  type PendingDevice = {
    approval_required: true;
    pairing_code: string;
    expires_at: string;
    device_label: string;
  };
  const [pending, setPending] = useState<PendingDevice | null>(null);
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<StaffAccount | PendingDevice>('/auth/device-session', {
          method: 'POST',
          body: '{}',
          signal: c.signal,
        });
        if (alive && !('approval_required' in result)) {
          nativeKitchenAction('session-changed');
          setUser(result);
          return;
        }
      } catch (e) {
        if (!alive) return;
        setError(errorMessage(e));
        if (e instanceof ApiError && [401, 403, 410].includes(e.status)) {
          setPending(null);
          return;
        }
      }
      if (alive) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      alive = false;
      c.abort();
      clearTimeout(timer);
    };
  }, [pending, setUser]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    prepareKitchenAudio();
    setBusy(true);
    setError('');
    try {
      const result = await api<StaffAccount | PendingDevice>('/auth/login', {
        method: 'POST',
        body: json({ username, password, device_label: deviceLabel }),
      });
      if ('approval_required' in result) setPending(result);
      else {
        nativeKitchenAction('session-changed');
        setUser(result);
      }
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
        <h1>{pending ? 'Подтвердите устройство' : 'Вход в кухню'}</h1>
        {pending ? (
          <section className="device-pairing" aria-live="polite">
            <p>
              Владелец должен подтвердить это устройство в разделе «Сотрудники → Кухни и
              устройства».
            </p>
            <strong className="pairing-code">{pending.pairing_code}</strong>
            <p>{pending.device_label} · заявка действует 10 минут</p>
            <p>После подтверждения вход продолжится автоматически.</p>
            {error && <Notice>{error}</Notice>}
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setPending(null);
                setError('');
              }}
            >
              Другой логин
            </button>
          </section>
        ) : (
          <>
            <p>Введите общий логин точки или личный логин владельца / управляющего.</p>
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
              Название устройства
              <input
                value={deviceLabel}
                maxLength={100}
                onChange={(e) => setDeviceLabel(e.target.value)}
                autoComplete="off"
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
          </>
        )}
        <p className="fine-print">Забыли пароль? Обратитесь к владельцу.</p>
        <p className="fine-print">
          <Link to="/privacy">Политика обработки данных</Link> ·{' '}
          <Link to="/consent">Отдельное согласие</Link>
        </p>
        <Link to="/">Меню для гостей</Link>
      </form>
    </main>
  );
}
