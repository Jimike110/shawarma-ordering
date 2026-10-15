import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, json } from '../api';
import { Notice } from '../ui';
import { useOwnerDraft } from '../ownerContext';
import { randomKey } from '../requestKey';
import type { StaffAccount, Store, Product } from '../types';

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
export type Action = (
  path: string,
  options: RequestInit,
  done?: (result: any) => void,
) => Promise<void>;
export function Modal({
  title,
  children,
  close,
  guard = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  guard?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  useOwnerDraft(guard && dirty);
  const dismiss = () => {
    if (
      !busy &&
      (!guard || !dirty || window.confirm('Есть несохранённые данные. Закрыть без сохранения?'))
    )
      close();
  };
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
        dismiss();
      }}
      onChange={() => {
        if (guard) setDirty(true);
      }}
    >
      <div className="section-top">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" disabled={busy} onClick={dismiss}>
          ×
        </button>
      </div>
      <fieldset className="owner-form-fields" disabled={busy}>
        {children}
      </fieldset>
    </dialog>
  );
}
export function NewStore({
  run,
  busy,
  done,
}: {
  run: Action;
  busy: boolean;
  done: (result: Store) => void;
}) {
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
export function UserForm({
  user,
  stores,
  run,
  busy,
  done,
  initialStore = '',
}: {
  user?: StaffAccount;
  stores: Store[];
  run: Action;
  busy: boolean;
  done: (r: any) => void;
  initialStore?: string;
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
          memberships: initialStore ? [{ store_id: Number(initialStore), role: 'worker' }] : [],
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
      <p className="owner-scope-label">Для всего бизнеса · сохраняются все назначения</p>
      <fieldset>
        <legend>Данные</legend>
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
      </fieldset>
      <fieldset>
        <legend>Доступ</legend>
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
      </fieldset>
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
                  {s.archived ? ' · архив' : ''}
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
export function StoreLifecycle({
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
export function CopyMenu({
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
      {source && (
        <p>
          Из: {stores.find((s) => String(s.id) === source)?.settings.address}. В:{' '}
          {destination.settings.address}.
        </p>
      )}
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
