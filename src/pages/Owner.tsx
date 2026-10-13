import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, errorMessage, json } from '../api';
import { usePolling } from '../usePolling';
import { StaffTop, useAuth } from '../staff';
import { Notice } from '../ui';
import { randomKey } from '../requestKey';
import type { StaffAccount, Store, Product } from '../types';
import { AnalyticsPanel, ActivityPanel, HistoryPanel } from './Reports';

type UserInput = Pick<
  StaffAccount,
  'username' | 'display_name' | 'phone' | 'email' | 'owner' | 'active' | 'memberships'
>;
const userInput = (u: StaffAccount): UserInput => ({
  username: u.username,
  display_name: u.display_name,
  phone: u.phone,
  email: u.email,
  owner: u.owner,
  active: u.active,
  memberships: u.memberships,
});
type Action = (path: string, options: RequestInit, done?: (result: any) => void) => Promise<void>;
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      restore.current?.focus();
    };
  }, []);
  return (
    <dialog
      className="admin-modal"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="section-top">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Owner() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<'overview' | 'stores' | 'staff' | 'analytics'>('overview'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      path: string;
      options: RequestInit;
      done?: (r: any) => void;
    } | null>(null),
    [confirm, setConfirm] = useState(''),
    [secret, setSecret] = useState(''),
    [secretError, setSecretError] = useState('');
  const [creatingStore, setCreatingStore] = useState(false),
    [editingUser, setEditingUser] = useState<StaffAccount | 'new' | null>(null),
    [copyStore, setCopyStore] = useState<Store | null>(null),
    [lifecycle, setLifecycle] = useState<{ store: Store; kind: 'stop' | 'archive' } | null>(null);
  const load = useCallback((signal: AbortSignal) => api<Store[]>('/owner/stores', { signal }), []);
  const stores = usePolling(load, 15000);
  const [users, setUsers] = useState<StaffAccount[]>([]);
  const refreshUsers = useCallback(async () => {
    try {
      setUsers(await api<StaffAccount[]>('/owner/users'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (tab === 'staff') void refreshUsers();
  }, [tab, refreshUsers]);
  const run: Action = async (path, options, done) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(path, options);
      done?.(result);
      stores.refresh();
      if (tab === 'staff') await refreshUsers();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'reauthentication_required') {
        setConfirm('');
        setPending({ path, options, done });
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  async function reauth(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await api('/auth/reauthenticate', { method: 'POST', body: json({ password: confirm }) });
      setConfirm('');
      const action = pending;
      setPending(null);
      const result = await api(action.path, action.options);
      action.done?.(result);
      stores.refresh();
      if (tab === 'staff') await refreshUsers();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const published = (stores.data ?? []).filter((s) => !s.archived);
  return (
    <main className="container owner">
      <StaffTop />
      <div className="section-top">
        <h1>Управление бизнесом</h1>
      </div>
      <nav className="owner-nav" aria-label="Разделы владельца">
        {(
          [
            ['overview', 'Обзор'],
            ['stores', 'Точки'],
            ['staff', 'Сотрудники'],
            ['analytics', 'Аналитика'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'selected' : ''}
            onClick={() => {
              setTab(id);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <Notice>{error}</Notice>}
      {stores.error && <Notice>{stores.error}</Notice>}
      {secret && (
        <section className="panel temporary-password" role="status">
          <h2>Временный пароль</h2>
          <p>Передайте сотруднику. Действует 24 часа, при входе потребуется сменить пароль.</p>
          <code>{secret}</code>
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret)
                  .catch(() => setSecretError('Не удалось скопировать. Выделите пароль вручную.'))
              }
            >
              Скопировать
            </button>
            <button
              className="button"
              onClick={() => {
                setSecret('');
                setSecretError('');
              }}
            >
              Я сохранил пароль
            </button>
          </div>
          {secretError && <Notice>{secretError}</Notice>}
        </section>
      )}
      {tab === 'overview' && (
        <>
          <h2>Состояние точек</h2>
          <div className="store-list">
            {published.map((s) => (
              <article className="panel store-card" key={s.id}>
                <div className="section-top">
                  <h3>{s.settings.shop_name}</h3>
                  <span
                    className={
                      'status-badge ' + (!s.accepting_orders ? 'status-cancelled' : 'status-ready')
                    }
                  >
                    {s.owner_stopped
                      ? 'Стоп владельца'
                      : !s.published
                        ? 'Не опубликована'
                        : s.settings.paused
                          ? 'Пауза'
                          : s.accepting_orders
                            ? 'Открыта'
                            : 'Закрыта'}
                  </span>
                </div>
                <p>{s.settings.address}</p>
                {s.owner_stopped && <p>Причина остановки: {s.stop_reason}</p>}
                <dl className="store-counts">
                  {[
                    ['new', 'Новые'],
                    ['preparing', 'Готовим'],
                    ['ready', 'К выдаче'],
                    ['overdue', 'Опаздывают'],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{s.counts?.[key] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
                <div className="form-actions">
                  <Link className="button secondary small" to={'/staff/stores/' + s.id}>
                    Открыть кухню
                  </Link>
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      s.owner_stopped
                        ? void run('/owner/stores/' + s.id, {
                            method: 'PATCH',
                            body: json({ owner_stopped: false, reason: '' }),
                          })
                        : setLifecycle({ store: s, kind: 'stop' })
                    }
                  >
                    {s.owner_stopped ? 'Снять стоп' : 'Остановить приём'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <HistoryPanel endpoint="/owner/orders" initialStatus="cancelled" compact />
          <ActivityPanel endpoint="/owner/activity" stores={stores.data ?? []} compact />
        </>
      )}
      {tab === 'stores' && (
        <>
          <div className="section-top">
            <h2>Точки</h2>
            <button className="button small" onClick={() => setCreatingStore(true)}>
              Добавить точку
            </button>
          </div>
          <div className="store-list">
            {(stores.data ?? []).map((s) => (
              <article className="panel store-card" key={s.id}>
                <h3>{s.settings.shop_name}</h3>
                <p>{s.settings.address}</p>
                <p>
                  {s.archived ? 'Архив' : s.published ? 'Опубликована' : 'Черновик'} ·{' '}
                  {s.intake_message}
                </p>
                {!s.archived && (
                  <>
                    <Link to={'/s/' + s.slug} target="_blank" rel="noreferrer">
                      Страница для гостей ↗
                    </Link>
                    <small>Эту ссылку можно использовать в QR-коде.</small>
                    <div className="form-actions">
                      <Link className="button secondary small" to={'/staff/stores/' + s.id}>
                        Меню и настройки
                      </Link>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          void run('/owner/stores/' + s.id, {
                            method: 'PATCH',
                            body: json({ published: !s.published }),
                          })
                        }
                      >
                        {s.published ? 'Скрыть из списка' : 'Опубликовать'}
                      </button>
                      <button className="button secondary small" onClick={() => setCopyStore(s)}>
                        Скопировать меню сюда
                      </button>
                      <button
                        className="text-link"
                        onClick={() => setLifecycle({ store: s, kind: 'archive' })}
                      >
                        В архив
                      </button>
                    </div>
                  </>
                )}
                {s.archived && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      void run('/owner/stores/' + s.id, {
                        method: 'PATCH',
                        body: json({ archived: false }),
                      })
                    }
                  >
                    Вернуть в черновики
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {tab === 'staff' && (
        <>
          <div className="section-top">
            <h2>Сотрудники</h2>
            <button className="button small" onClick={() => setEditingUser('new')}>
              Добавить сотрудника
            </button>
          </div>
          <div className="staff-user-list">
            {users.map((u) => (
              <article className="panel staff-user" key={u.id}>
                <div>
                  <h3>{u.display_name}</h3>
                  <p>
                    {u.username} · {u.owner ? 'Владелец' : u.active ? 'Активен' : 'Отключён'}
                    {u.password_required ? ' · Требуется смена пароля' : ''}
                  </p>
                  <p>{[u.phone, u.email].filter(Boolean).join(' · ')}</p>
                  {u.owner ? (
                    <small>Все точки</small>
                  ) : (
                    <ul>
                      {u.memberships.map((m) => (
                        <li key={m.store_id}>
                          {stores.data?.find((s) => s.id === m.store_id)?.settings.address ??
                            'Точка ' + m.store_id}{' '}
                          — {m.role === 'manager' ? 'управляющий' : 'сотрудник'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <small>
                    {u.last_login_at
                      ? 'Последний вход: ' +
                        new Date(u.last_login_at).toLocaleString('ru-RU', {
                          timeZone: 'Europe/Moscow',
                        })
                      : 'Ещё не входил'}
                  </small>
                </div>
                <div className="form-actions">
                  <button className="button secondary small" onClick={() => setEditingUser(u)}>
                    Изменить доступ
                  </button>
                  {u.id === currentUser?.id ? (
                    <Link className="button secondary small" to="/staff/account">
                      Сменить мой пароль
                    </Link>
                  ) : (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          '/owner/users/' + u.id + '/reset-password',
                          { method: 'POST', body: '{}' },
                          (r) => setSecret(r.temporary_password),
                        )
                      }
                    >
                      Выдать новый пароль
                    </button>
                  )}
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      void run('/owner/users/' + u.id, {
                        method: 'PUT',
                        body: json({ ...userInput(u), active: !u.active }),
                      })
                    }
                  >
                    {u.active ? 'Отключить' : 'Включить'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === 'analytics' && (
        <AnalyticsPanel endpoint="/owner/analytics" stores={stores.data ?? []} />
      )}
      {pending && (
        <Modal
          title="Подтвердите пароль"
          close={() => {
            if (!busy) {
              setPending(null);
              setConfirm('');
            }
          }}
        >
          <form onSubmit={reauth}>
            <p>Для изменения доступа или управления точками подтвердите свой пароль.</p>
            <label>
              Ваш пароль
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && <Notice>{error}</Notice>}
            <button className="button" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </Modal>
      )}
      {creatingStore && (
        <Modal title="Новая точка" close={() => setCreatingStore(false)}>
          {error && <Notice>{error}</Notice>}
          <NewStore run={run} busy={busy} done={() => setCreatingStore(false)} />
        </Modal>
      )}
      {editingUser && (
        <Modal
          title={editingUser === 'new' ? 'Новый сотрудник' : 'Доступ сотрудника'}
          close={() => setEditingUser(null)}
        >
          {error && <Notice>{error}</Notice>}
          <UserForm
            user={editingUser === 'new' ? undefined : editingUser}
            stores={published}
            busy={busy}
            run={run}
            done={(r) => {
              setEditingUser(null);
              if (r.temporary_password) setSecret(r.temporary_password);
            }}
          />
        </Modal>
      )}
      {copyStore && (
        <Modal title="Копирование меню" close={() => setCopyStore(null)}>
          {error && <Notice>{error}</Notice>}
          <CopyMenu
            destination={copyStore}
            stores={published}
            busy={busy}
            run={run}
            done={() => setCopyStore(null)}
          />
        </Modal>
      )}
      {lifecycle && (
        <Modal
          title={lifecycle.kind === 'stop' ? 'Остановить приём заказов' : 'Архивировать точку'}
          close={() => setLifecycle(null)}
        >
          {error && <Notice>{error}</Notice>}
          <StoreLifecycle
            store={lifecycle.store}
            kind={lifecycle.kind}
            busy={busy}
            run={run}
            done={() => setLifecycle(null)}
          />
        </Modal>
      )}
    </main>
  );
}
function NewStore({ run, busy, done }: { run: Action; busy: boolean; done: () => void }) {
  const [name, setName] = useState(''),
    [address, setAddress] = useState(''),
    [slug, setSlug] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run('/owner/stores', { method: 'POST', body: json({ name, address, slug }) }, done);
      }}
    >
      <label>
        Название
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Адрес
        <input
          required
          maxLength={200}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label>
        Адрес ссылки
        <input
          required
          pattern="[a-z0-9][a-z0-9-]{2,59}"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="lenskaya-18"
        />
      </label>
      <p className="fine-print">
        Латинские буквы, цифры и дефис. Ссылка останется постоянной. Точка создаётся
        неопубликованной.
      </p>
      <button className="button" disabled={busy}>
        Создать точку
      </button>
    </form>
  );
}
function UserForm({
  user,
  stores,
  run,
  busy,
  done,
}: {
  user?: StaffAccount;
  stores: Store[];
  run: Action;
  busy: boolean;
  done: (r: any) => void;
}) {
  const [value, setValue] = useState<UserInput>(
    user
      ? userInput(user)
      : {
          username: '',
          display_name: '',
          phone: '',
          email: '',
          owner: false,
          active: true,
          memberships: [],
        },
  );
  const change = <K extends keyof UserInput>(key: K, v: UserInput[K]) =>
    setValue((p) => ({ ...p, [key]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          user ? '/owner/users/' + user.id : '/owner/users',
          { method: user ? 'PUT' : 'POST', body: json(value) },
          done,
        );
      }}
    >
      <label>
        Имя сотрудника
        <input
          required
          maxLength={100}
          value={value.display_name}
          onChange={(e) => change('display_name', e.target.value)}
        />
      </label>
      <label>
        Логин
        <input
          required
          pattern="[a-z0-9][a-z0-9_.-]{2,59}"
          maxLength={60}
          autoComplete="off"
          value={value.username}
          onChange={(e) => change('username', e.target.value.toLowerCase())}
        />
      </label>
      <label>
        Телефон
        <input
          type="tel"
          maxLength={50}
          value={value.phone}
          onChange={(e) => change('phone', e.target.value)}
        />
      </label>
      <label>
        Email
        <input
          type="email"
          maxLength={254}
          value={value.email}
          onChange={(e) => change('email', e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => change('active', e.target.checked)}
        />
        Доступ включён
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.owner}
          onChange={(e) => change('owner', e.target.checked)}
        />
        Владелец — полный доступ ко всем точкам
      </label>
      {!value.owner && (
        <fieldset>
          <legend>Точки и роли</legend>
          {stores.map((s) => {
            const m = value.memberships.find((m) => m.store_id === s.id);
            return (
              <div className="assignment" key={s.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!m}
                    onChange={(e) =>
                      change(
                        'memberships',
                        e.target.checked
                          ? [...value.memberships, { store_id: s.id, role: 'worker' }]
                          : value.memberships.filter((m) => m.store_id !== s.id),
                      )
                    }
                  />
                  {s.settings.address}
                </label>
                {m && (
                  <label>
                    Роль
                    <select
                      value={m.role}
                      onChange={(e) =>
                        change(
                          'memberships',
                          value.memberships.map((v) =>
                            v.store_id === s.id
                              ? { ...v, role: e.target.value as 'worker' | 'manager' }
                              : v,
                          ),
                        )
                      }
                    >
                      <option value="worker">Сотрудник</option>
                      <option value="manager">Управляющий</option>
                    </select>
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      <button className="button" disabled={busy}>
        {user ? 'Сохранить доступ' : 'Создать и выдать пароль'}
      </button>
    </form>
  );
}
function StoreLifecycle({
  store,
  kind,
  run,
  busy,
  done,
}: {
  store: Store;
  kind: 'stop' | 'archive';
  run: Action;
  busy: boolean;
  done: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          '/owner/stores/' + store.id,
          {
            method: 'PATCH',
            body: json(kind === 'stop' ? { owner_stopped: true, reason } : { archived: true }),
          },
          done,
        );
      }}
    >
      <p>{store.settings.address}</p>
      {kind === 'stop' ? (
        <>
          <p>Только владелец сможет снять этот стоп. Активные заказы остаются в работе.</p>
          <label>
            Причина остановки
            <textarea
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      ) : (
        <p>
          Точка исчезнет из списка для гостей. Заказы и отчёты сохранятся. Сначала нужно завершить
          активные заказы.
        </p>
      )}
      <button className="button" disabled={busy}>
        {kind === 'stop' ? 'Остановить приём' : 'В архив'}
      </button>
    </form>
  );
}
function CopyMenu({
  destination,
  stores,
  run,
  busy,
  done,
}: {
  destination: Store;
  stores: Store[];
  run: Action;
  busy: boolean;
  done: () => void;
}) {
  const [source, setSource] = useState(''),
    [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState('');
  const key = useRef(randomKey());
  useEffect(() => {
    setProducts([]);
    setSelected([]);
    key.current = randomKey();
    if (!source) return;
    const c = new AbortController();
    api<{ products: Product[] }>('/staff/stores/' + source + '/menu', { signal: c.signal })
      .then((r) => setProducts(r.products))
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [source]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          '/owner/menu-copy',
          {
            method: 'POST',
            body: json({
              source_store_id: Number(source),
              destination_store_id: destination.id,
              product_ids: selected,
              request_key: key.current,
            }),
          },
          done,
        );
      }}
    >
      <p>
        В точку {destination.settings.address}. Существующие товары сохранятся. Копии появятся как
        недоступные.
      </p>
      <label>
        Откуда скопировать
        <select required value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Выберите точку</option>
          {stores
            .filter((s) => s.id !== destination.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.settings.address}
              </option>
            ))}
        </select>
      </label>
      {error && <Notice>{error}</Notice>}
      {products.map((p) => (
        <label className="checkbox" key={p.id}>
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={(e) => {
              key.current = randomKey();
              setSelected(
                e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id),
              );
            }}
          />
          {p.name}
        </label>
      ))}
      <button className="button" disabled={busy || !selected.length}>
        Скопировать выбранные товары
      </button>
    </form>
  );
}
