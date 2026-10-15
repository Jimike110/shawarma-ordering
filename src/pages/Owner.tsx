import { useOwnerDraft, useOwnerWorkspace } from '../ownerContext';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, MapPin, Plus, Search, Users } from 'lucide-react';
import { api, ApiError, errorMessage, json } from '../api';
import { usePolling } from '../usePolling';
import { useAuth } from '../auth';
import { Notice } from '../ui';
import { ActionMenu, IntakeState, OwnerLoading, RefreshStatus } from '../ownerWorkspace';
import type { StaffAccount, Store } from '../types';
import { AnalyticsPanel, ActivityPanel, HistoryPanel, TodaySummary } from './Reports';
import { CopyMenu, Modal, NewStore, StoreLifecycle, UserForm, type Action } from './OwnerForms';
export { Modal } from './OwnerForms';
const userInput = (u: StaffAccount) => ({
  username: u.username,
  display_name: u.display_name,
  phone: u.phone,
  email: u.email,
  owner: u.owner,
  active: u.active,
  memberships: u.memberships,
});

export function Owner({
  section = 'overview',
}: {
  section?: 'overview' | 'stores' | 'staff' | 'analytics';
}) {
  const { user } = useAuth();
  const { stores, visible, selected, href, refresh, selectStore } = useOwnerWorkspace();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  type Pending = { path: string; options: RequestInit; done?: (r: any) => void };
  const [pending, setPending] = useState<Pending | null>(null),
    [confirm, setConfirm] = useState('');
  const [secret, setSecret] = useState(''),
    [secretError, setSecretError] = useState('');
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<StaffAccount | 'new' | null>(null);
  const [copy, setCopy] = useState<Store | null>(null),
    [lifecycle, setLifecycle] = useState<{ store: Store; kind: 'stop' | 'archive' } | null>(null);
  const [accountAction, setAccountAction] = useState<{
    user: StaffAccount;
    kind: 'disable' | 'reset';
  } | null>(null);
  const search = params.get('q') ?? '',
    filter = params.get('filter') ?? (selected && visible[0]?.archived ? 'archive' : 'active'),
    status = params.get('access') ?? 'all',
    role = params.get('role') ?? 'all';
  function query(key: string, value: string, replace = false) {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete('before');
    setParams(p, { replace });
  }
  const setSearch = (v: string) => query('q', v, true),
    setFilter = (v: string) => query('filter', v),
    setStatus = (v: string) => query('access', v),
    setRole = (v: string) => query('role', v);
  useOwnerDraft(!!secret);
  const loadUsers = useCallback(
    (signal: AbortSignal) => api<StaffAccount[]>('/owner/users', { signal }),
    [],
  );
  const users = usePolling(loadUsers, 30000, section === 'staff');
  useEffect(() => {
    setError('');
    setMessage('');
  }, [section]);
  function completed(result: any, done?: Pending['done']) {
    done?.(result);
    refresh();
    users.refresh();
    setMessage('Изменения сохранены.');
  }
  const run: Action = async (path, options, done) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      completed(await api(path, options), done);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'reauthentication_required') {
        setConfirm('');
        setPending({ path, options, done });
      } else setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  async function reauth(e: FormEvent) {
    e.preventDefault();
    if (!pending || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/auth/reauthenticate', { method: 'POST', body: json({ password: confirm }) });
      const action = pending;
      setConfirm('');
      setPending(null);
      completed(await api(action.path, action.options), action.done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const active = visible.filter((s) => !s.archived),
    term = search.toLocaleLowerCase('ru').trim();
  const storeRows = visible.filter(
    (s) =>
      (filter === 'archive' ? s.archived : !s.archived) &&
      (filter !== 'open' || s.accepting_orders) &&
      (filter !== 'closed' || !s.accepting_orders) &&
      (filter !== 'draft' || !s.published) &&
      (!term ||
        (s.settings.shop_name + ' ' + s.settings.address).toLocaleLowerCase('ru').includes(term)),
  );
  const staffRows = (users.data ?? []).filter(
    (u) =>
      (!selected || u.owner || u.memberships.some((m) => String(m.store_id) === selected)) &&
      (status === 'all' || (status === 'active' ? u.active : !u.active)) &&
      (role === 'all' ||
        (role === 'owner'
          ? u.owner
          : !u.owner &&
            u.memberships.some(
              (m) => m.role === role && (!selected || String(m.store_id) === selected),
            ))) &&
      (!term ||
        [u.display_name, u.username, u.phone, u.email]
          .join(' ')
          .toLocaleLowerCase('ru')
          .includes(term)),
  );
  const storeActions = (s: Store) => (
    <ActionMenu label="Действия">
      {!s.archived ? (
        <>
          <Link to={'/s/' + s.slug} target="_blank" rel="noreferrer">
            Страница для гостей ↗
          </Link>
          <Link to={'/staff/stores/' + s.id}>Меню и настройки</Link>
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  (s.published ? 'Скрыть' : 'Опубликовать') +
                    ' точку «' +
                    s.settings.address +
                    '»?',
                )
              )
                void run('/owner/stores/' + s.id, {
                  method: 'PATCH',
                  body: json({ published: !s.published }),
                });
            }}
          >
            {s.published ? 'Скрыть из списка' : 'Опубликовать'}
          </button>
          <button disabled={busy} onClick={() => setCopy(s)}>
            Скопировать меню сюда
          </button>
          <button
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
          <button
            className="owner-danger"
            disabled={busy}
            onClick={() => setLifecycle({ store: s, kind: 'archive' })}
          >
            В архив
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() =>
            void run('/owner/stores/' + s.id, { method: 'PATCH', body: json({ archived: false }) })
          }
        >
          Вернуть в черновики
        </button>
      )}
    </ActionMenu>
  );
  return (
    <div className="owner-page">
      <div className="owner-page-heading">
        <div>
          <h1>
            {section === 'overview'
              ? 'Управление бизнесом'
              : section === 'stores'
                ? 'Точки'
                : section === 'staff'
                  ? 'Сотрудники'
                  : 'Аналитика'}
          </h1>
          <p>
            {section === 'overview'
              ? 'Состояние точек и заказы прямо сейчас'
              : section === 'stores'
                ? 'Приём заказов, меню и доступность точек'
                : section === 'staff'
                  ? 'Учётные записи и доступ к работе'
                  : 'Результаты, история заказов и действия сотрудников'}
          </p>
        </div>
        {section === 'stores' && (
          <button className="button small" onClick={() => setCreating(true)}>
            <Plus size={17} />
            Добавить точку
          </button>
        )}
        {section === 'staff' && (
          <button className="button small" onClick={() => setEditing('new')}>
            <Plus size={17} />
            Добавить сотрудника
          </button>
        )}
      </div>
      {error && !pending && <Notice>{error}</Notice>}
      {message && (
        <p className="owner-success" role="status">
          {message}
        </p>
      )}
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
      {section === 'overview' && (
        <>
          <Attention stores={active} />
          <section className="owner-section">
            <div className="owner-section-heading">
              <h2>Точки сейчас</h2>
              <Link to={href('/owner/stores')}>
                Все точки <ArrowRight size={15} />
              </Link>
            </div>
            <div className="owner-store-list">
              {active.map((s) => (
                <StoreRow key={s.id} store={s} actions={storeActions(s)} />
              ))}
            </div>
            {!active.length && (
              <Empty
                text={
                  visible.length
                    ? 'Точка в архиве. История и отчёты доступны в аналитике.'
                    : 'Пока нет точек. Добавьте первую, чтобы начать работу.'
                }
              />
            )}
          </section>
          <TodaySummary storeId={selected} />
          <div className="owner-recent-grid">
            <section className="owner-section">
              <div className="owner-section-heading">
                <h2>Последние отмены</h2>
                <Link to={href('/owner/analytics', { view: 'orders', status: 'cancelled' })}>
                  Все отмены <ArrowRight size={15} />
                </Link>
              </div>
              <HistoryPanel
                key={selected + ':recent'}
                endpoint="/owner/orders"
                storeId={selected}
                initialStatus="cancelled"
                compact
                hideHeading
              />
            </section>
            <section className="owner-section">
              <div className="owner-section-heading">
                <h2>Последние действия</h2>
                <Link to={href('/owner/analytics', { view: 'activity' })}>
                  Все действия <ArrowRight size={15} />
                </Link>
              </div>
              <ActivityPanel
                key={selected + ':recent'}
                endpoint="/owner/activity"
                stores={stores ?? []}
                storeId={selected}
                compact
                hideHeading
              />
            </section>
          </div>
        </>
      )}
      {section === 'stores' && (
        <>
          <div className="owner-filters">
            <SearchField
              value={search}
              change={setSearch}
              label="Найти точку"
              placeholder="Название или адрес"
            />
            <label>
              Состояние
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="active">Все действующие</option>
                <option value="open">Принимают</option>
                <option value="closed">Не принимают</option>
                <option value="draft">Черновики</option>
                <option value="archive">Архив</option>
              </select>
            </label>
          </div>
          <p className="owner-list-count">Точек: {storeRows.length}</p>
          <div className="owner-store-list">
            {storeRows.map((s) => (
              <StoreRow key={s.id} store={s} actions={storeActions(s)} details />
            ))}
          </div>
          {!storeRows.length && (
            <Empty text="Точек с такими условиями нет. Измените поиск или фильтр." />
          )}
        </>
      )}
      {section === 'staff' && (
        <>
          <div className="owner-filters">
            <SearchField
              value={search}
              change={setSearch}
              label="Найти сотрудника"
              placeholder="Имя, логин или контакт"
            />
            <label>
              Доступ
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Любой</option>
                <option value="active">Включён</option>
                <option value="disabled">Отключён</option>
              </select>
            </label>
            <label>
              Роль
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="all">Все роли</option>
                <option value="owner">Владелец</option>
                <option value="manager">Управляющий</option>
                <option value="worker">Сотрудник</option>
              </select>
            </label>
          </div>
          <RefreshStatus
            error={users.error}
            lastUpdated={users.lastUpdated}
            refresh={users.refresh}
          />
          {!users.data && !users.error && <OwnerLoading />}
          {users.data && (
            <>
              <p className="owner-list-count">Учётных записей: {staffRows.length}</p>
              <div className="owner-staff-list">
                {staffRows.map((u) => (
                  <article className="staff-user owner-staff-row" key={u.id}>
                    <div className="owner-person">
                      <span className="owner-avatar" aria-hidden="true">
                        {u.display_name.slice(0, 1)}
                      </span>
                      <div>
                        <h3>
                          {u.display_name}
                          {u.id === user?.id && <small> · Вы</small>}
                        </h3>
                        <p>{u.username}</p>
                        {(u.phone || u.email) && (
                          <small>{[u.phone, u.email].filter(Boolean).join(' · ')}</small>
                        )}
                      </div>
                    </div>
                    <div className="owner-assignments">
                      {u.owner ? (
                        <span>Владелец · Все точки</span>
                      ) : u.memberships.length ? (
                        u.memberships
                          .filter((m) => !selected || String(m.store_id) === selected)
                          .map((m) => (
                            <span key={m.store_id}>
                              {stores?.find((s) => s.id === m.store_id)?.settings.address ??
                                'Точка ' + m.store_id}
                              <small>{m.role === 'manager' ? 'Управляющий' : 'Сотрудник'}</small>
                            </span>
                          ))
                      ) : (
                        <span className="fine-print">Нет назначенных точек</span>
                      )}
                    </div>
                    <div className="owner-account-state">
                      <span className={'owner-state ' + (u.active ? 'is-open' : 'is-closed')}>
                        {u.active ? 'Доступ включён' : 'Доступ отключён'}
                      </span>
                      {u.password_required && <small>Требуется смена пароля</small>}
                      <small>
                        {u.last_login_at
                          ? 'Вход: ' +
                            new Date(u.last_login_at).toLocaleString('ru-RU', {
                              timeZone: 'Europe/Moscow',
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : 'Ещё не входил'}
                      </small>
                    </div>
                    <ActionMenu label="Действия">
                      <button disabled={busy} onClick={() => setEditing(u)}>
                        Изменить доступ
                      </button>
                      {u.id === user?.id ? (
                        <Link to="/staff/account">Сменить мой пароль</Link>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => setAccountAction({ user: u, kind: 'reset' })}
                        >
                          Выдать новый пароль
                        </button>
                      )}
                      <button
                        disabled={busy}
                        className="owner-danger"
                        onClick={() =>
                          u.active
                            ? setAccountAction({ user: u, kind: 'disable' })
                            : void run('/owner/users/' + u.id, {
                                method: 'PUT',
                                body: json({ ...userInput(u), active: true }),
                              })
                        }
                      >
                        {u.active ? 'Отключить' : 'Включить'}
                      </button>
                    </ActionMenu>
                  </article>
                ))}
              </div>
              {!staffRows.length && (
                <Empty
                  staff
                  text="Сотрудников с такими условиями нет. Проверьте выбранную точку и фильтры."
                />
              )}
            </>
          )}
        </>
      )}
      {section === 'analytics' && (
        <>
          <Subnav
            values={[
              ['summary', 'Показатели'],
              ['orders', 'История заказов'],
              ['activity', 'Действия'],
            ]}
            value={params.get('view') ?? 'summary'}
            change={(v) => {
              const p = new URLSearchParams(params);
              p.set('view', v);
              p.delete('before');
              setParams(p);
            }}
          />
          {(!params.get('view') || !['orders', 'activity'].includes(params.get('view')!)) && (
            <AnalyticsPanel endpoint="/owner/analytics" stores={stores ?? []} owner />
          )}
          {params.get('view') === 'orders' && (
            <HistoryPanel
              key={selected + ':history'}
              endpoint="/owner/orders"
              storeId={selected}
              owner
            />
          )}
          {params.get('view') === 'activity' && (
            <ActivityPanel
              key={selected + ':activity'}
              endpoint="/owner/activity"
              storeId={selected}
              stores={stores ?? []}
              owner
            />
          )}
        </>
      )}
      {pending && (
        <Modal
          title="Подтвердите пароль"
          busy={busy}
          close={() => {
            setPending(null);
            setConfirm('');
          }}
        >
          <form onSubmit={reauth}>
            <p>Изменение будет применено к ранее выбранной точке или учётной записи.</p>
            <label>
              Ваш пароль
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                required
                value={confirm}
                maxLength={128}
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
      {creating && (
        <Modal title="Новая точка" guard busy={busy} close={() => setCreating(false)}>
          {error && <Notice>{error}</Notice>}
          <NewStore
            run={run}
            busy={busy}
            done={(r?: any) => {
              setCreating(false);
              selectStore(String(r.id), true);
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === 'new' ? 'Новый сотрудник' : 'Доступ сотрудника'}
          guard
          busy={busy}
          close={() => setEditing(null)}
        >
          {error && <Notice>{error}</Notice>}
          <UserForm
            user={editing === 'new' ? undefined : editing}
            stores={stores ?? []}
            initialStore={selected}
            busy={busy}
            run={run}
            done={(r) => {
              setEditing(null);
              if (r.temporary_password) setSecret(r.temporary_password);
            }}
          />
        </Modal>
      )}
      {copy && (
        <Modal title="Копирование меню" guard busy={busy} close={() => setCopy(null)}>
          {error && <Notice>{error}</Notice>}
          <CopyMenu
            destination={copy}
            stores={(stores ?? []).filter((s) => !s.archived)}
            busy={busy}
            run={run}
            done={() => setCopy(null)}
          />
        </Modal>
      )}
      {lifecycle && (
        <Modal
          title={lifecycle.kind === 'stop' ? 'Остановить приём заказов' : 'Архивировать точку'}
          guard
          busy={busy}
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
      {accountAction && (
        <Modal
          title={accountAction.kind === 'reset' ? 'Выдать новый пароль' : 'Отключить доступ'}
          busy={busy}
          close={() => setAccountAction(null)}
        >
          <p>
            <strong>{accountAction.user.display_name}</strong> · {accountAction.user.username}
          </p>
          <p>
            Для всего бизнеса. Все текущие сеансы сотрудника будут завершены.
            {accountAction.kind === 'reset' && ' Временный пароль действует 24 часа.'}
          </p>
          {error && <Notice>{error}</Notice>}
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(
                '/owner/users/' +
                  accountAction.user.id +
                  (accountAction.kind === 'reset' ? '/reset-password' : ''),
                {
                  method: accountAction.kind === 'reset' ? 'POST' : 'PUT',
                  body: json(
                    accountAction.kind === 'reset'
                      ? {}
                      : { ...userInput(accountAction.user), active: false },
                  ),
                },
                (r) => {
                  setAccountAction(null);
                  if (r.temporary_password) setSecret(r.temporary_password);
                },
              )
            }
          >
            Подтвердить
          </button>
        </Modal>
      )}
    </div>
  );
}
function StoreRow({
  store: s,
  actions,
  details = false,
}: {
  store: Store;
  actions: ReactNode;
  details?: boolean;
}) {
  return (
    <article className="owner-store-row">
      <div className="owner-store-identity">
        <span className="owner-row-icon">
          <MapPin size={19} />
        </span>
        <div>
          <h3>{s.settings.address || s.settings.shop_name}</h3>
          <small>
            {s.settings.shop_name} ·{' '}
            {s.archived ? 'Архив' : s.published ? 'Опубликована' : 'Черновик'}
          </small>
        </div>
      </div>
      <div className="owner-store-operation">
        <IntakeState store={s} full={details} />
        <small>Подготовка: {s.settings.prep_minutes} мин</small>
      </div>
      <dl className="owner-queue">
        {[
          ['new', 'Новые'],
          ['preparing', 'Готовим'],
          ['ready', 'К выдаче'],
          ['overdue', 'Опаздывают'],
        ].map(([key, label]) => (
          <div key={key} className={key === 'overdue' && s.counts?.[key] ? 'owner-overdue' : ''}>
            <dt>{label}</dt>
            <dd>{s.counts?.[key] ?? 0}</dd>
          </div>
        ))}
      </dl>
      <div className="owner-row-actions">
        {!s.archived && (
          <Link className="button secondary small" to={'/staff/stores/' + s.id}>
            Открыть кухню
          </Link>
        )}
        {actions}
      </div>
    </article>
  );
}
function Attention({ stores }: { stores: Store[] }) {
  const { href } = useOwnerWorkspace();
  const privacy = stores.filter((s) => s.intake_blockers?.includes('privacy_unpublished'));
  const issues = stores.filter(
    (s) => s.owner_stopped || s.settings.paused || (s.counts?.overdue ?? 0) > 0,
  );
  return (
    <section className="owner-section owner-attention">
      <div className="owner-section-heading">
        <h2>
          <AlertCircle size={19} />
          Требует внимания
        </h2>
      </div>
      {!privacy.length && !issues.length ? (
        <p className="owner-no-issues">
          Нет проблем, требующих внимания. Текущий режим работы каждой точки указан ниже.
        </p>
      ) : (
        <div className="owner-issue-list">
          {!!privacy.length && (
            <article>
              <div>
                <strong>Не опубликованы документы оператора</strong>
                <p>
                  {privacy.map((s) => s.settings.address).join(' · ')} — новые заказы заблокированы.
                </p>
              </div>
              <Link to={href('/owner/privacy')}>
                Настроить документы <ArrowRight size={15} />
              </Link>
            </article>
          )}
          {issues.map((s) => (
            <article key={s.id}>
              <div>
                <strong>{s.settings.address}</strong>
                <p>
                  {[
                    s.owner_stopped
                      ? 'Стоп владельца' + (s.stop_reason ? ': ' + s.stop_reason : '')
                      : '',
                    s.settings.paused
                      ? 'Пауза кухни' +
                        (s.settings.pause_message ? ': ' + s.settings.pause_message : '')
                      : '',
                    s.counts?.overdue ? 'Опаздывают: ' + s.counts.overdue : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Link
                to={
                  s.owner_stopped
                    ? href('/owner/stores', { store_id: String(s.id) })
                    : '/staff/stores/' + s.id
                }
              >
                {s.owner_stopped ? 'Управлять точкой' : 'Открыть кухню'} <ArrowRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function SearchField({
  value,
  change,
  label,
  placeholder,
}: {
  value: string;
  change: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <label className="owner-search">
      {label}
      <span>
        <Search size={17} />
        <input
          type="search"
          value={value}
          onChange={(e) => change(e.target.value)}
          placeholder={placeholder}
        />
      </span>
    </label>
  );
}
function Empty({ text, staff = false }: { text: string; staff?: boolean }) {
  const Icon = staff ? Users : MapPin;
  return (
    <div className="owner-empty">
      <Icon size={26} />
      <p>{text}</p>
    </div>
  );
}
export function Subnav({
  values,
  value,
  change,
}: {
  values: string[][];
  value: string;
  change: (v: string) => void;
}) {
  return (
    <nav className="owner-subnav" aria-label="Подразделы">
      {values.map(([id, label]) => (
        <button type="button" key={id} aria-pressed={value === id} onClick={() => change(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
