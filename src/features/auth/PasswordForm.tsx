import { useAuth } from '@/features/auth/authContext';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, errorMessage, json } from '@/shared/api/client';
import { type StaffAccount } from '@/shared/api/types';
import { Notice } from '@/shared/ui/Feedback';

export function PasswordForm({ required = false }: { required?: boolean }) {
  const { user, setUser, logout } = useAuth();
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  if (user?.account_type === 'kitchen') return <Navigate to="/kitchen" replace />;
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
