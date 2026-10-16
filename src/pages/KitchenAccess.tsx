import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, json } from '../api';
import { usePolling } from '../usePolling';
import { useOwnerDraft, useOwnerWorkspace } from '../ownerContext';
import { Notice } from '../ui';
import { RefreshStatus } from '../ownerWorkspace';
import { Modal, type Action } from './OwnerForms';
import type { StaffAccount, Store } from '../types';

interface Device {
  id: number;
  label: string;
  state: 'pending' | 'approved' | 'revoked';
  pairing_code: string;
  pending_until: string;
  store_id: number | null;
  last_seen_at: string | null;
  login_until: string | null;
  app_version: string;
  monitoring: boolean;
  audio_ready: boolean;
  volume: number;
  connection_ok: boolean;
  online: boolean;
  healthy: boolean;
}
interface Access {
  accounts: StaffAccount[];
  devices: Device[];
  server_time: string;
}
export function KitchenAccessPanel({
  overview = false,
  action,
  busy = false,
}: {
  overview?: boolean;
  action?: Action;
  busy?: boolean;
}) {
  const { visible, selected } = useOwnerWorkspace();
  const load = useCallback(
    (signal: AbortSignal) => api<Access>('/owner/kitchen-access', { signal }),
    [],
  );
  const q = usePolling(load, 15000);
  const [editing, setEditing] = useState<Store | null>(null);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    path: string;
    body: object;
  } | null>(null);
  useOwnerDraft(!!secret || !!editing);
  const devices = (q.data?.devices ?? []).filter(
    (d) => !selected || String(d.store_id) === selected,
  );
  const done = (r: { password?: string }) => {
    if (r.password) setSecret(r.password);
    setEditing(null);
    setConfirm(null);
    q.refresh();
  };
  function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || !action) return;
    void action(
      '/owner/stores/' + editing.id + '/kitchen-access',
      { method: 'PUT', body: json({ username, active: true }) },
      done,
    );
  }
  function accountAction(store: Store, account: StaffAccount, kind: 'rotate' | 'disable' | 'end') {
    setConfirm({
      title:
        kind === 'rotate'
          ? 'Выдать новый пароль точки?'
          : kind === 'disable'
            ? 'Отключить общий вход?'
            : 'Завершить все входы точки?',
      description:
        store.settings.address +
        '. Все устройства этой точки будут отключены. Подтверждение устройств сохранится; для работы потребуется новый вход.',
      path: '/owner/stores/' + store.id + '/kitchen-access',
      body: {
        username: account.username,
        active: kind !== 'disable',
        rotate_password: kind === 'rotate',
        end_sessions: kind === 'end',
      },
    });
  }
  return (
    <section
      className="owner-section kitchen-access-panel"
      aria-label={overview ? 'Связь с кухнями' : 'Кухни и устройства'}
    >
      <div className="owner-section-heading">
        <h2>{overview ? 'Связь с кухнями' : 'Кухни и устройства'}</h2>
        {overview && <Link to="/owner/staff">Управлять доступом</Link>}
      </div>
      <RefreshStatus error={q.error} lastUpdated={q.lastUpdated} refresh={q.refresh} />
      {!q.data && !q.error && <p>Проверяем устройства…</p>}
      {q.data && (
        <div className="kitchen-coverage-list">
          {visible
            .filter((s) => !s.archived)
            .map((s) => {
              const account =
                q.data!.accounts.find((u) => u.kitchen_store_id === s.id && u.active) ??
                q.data!.accounts.find((u) => u.kitchen_store_id === s.id);
              const atStore = q.data!.devices.filter((d) => d.store_id === s.id);
              const healthy = atStore.filter((d) => d.healthy).length;
              return (
                <article key={s.id} className="kitchen-coverage-row">
                  <div>
                    <h3>{s.settings.address}</h3>
                    <p className={healthy ? '' : 'text-error'}>
                      {healthy
                        ? `Готовы к оповещениям: ${healthy}`
                        : 'Нет подтверждённой связи с кухней'}
                    </p>
                    <small>
                      Приём заказов при потере связи продолжается. Проверка устройства не
                      подтверждает, что сотрудник услышал сигнал.
                    </small>
                  </div>
                  {!overview && (
                    <div>
                      <p>
                        {account
                          ? `${account.username} · ${account.active ? 'Включён' : 'Отключён'}`
                          : 'Общий логин ещё не создан'}
                      </p>
                      <div className="form-actions">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing(s);
                            setUsername(account?.username ?? 'kitchen-' + s.id);
                          }}
                        >
                          {' '}
                          {account ? 'Изменить / включить' : 'Создать логин точки'}
                        </button>
                        {account && (
                          <>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => accountAction(s, account, 'rotate')}
                            >
                              Новый пароль
                            </button>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => accountAction(s, account, 'end')}
                            >
                              Завершить входы
                            </button>
                            {account.active && (
                              <button
                                className="text-link text-error"
                                disabled={busy}
                                onClick={() => accountAction(s, account, 'disable')}
                              >
                                Отключить
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      )}
      {!overview && (
        <>
          <p className="fine-print">
            Один логин точки, несколько подтверждённых устройств. Только работа с заказами и
            доступностью. Личные аккаунты владельцев и управляющих остаются отдельными. Перед
            переходом отключите прежние индивидуальные аккаунты работников в списке ниже.
          </p>
          {devices.length > 0 && (
            <div className="kitchen-device-list">
              {devices.map((d) => (
                <article key={d.id} className="panel kitchen-device-row">
                  <div>
                    <h3>{d.label}</h3>
                    <p>
                      {visible.find((s) => s.id === d.store_id)?.settings.address ??
                        'Без текущей точки'}
                    </p>
                    {d.state === 'pending' ? (
                      <>
                        <strong className="pairing-code">{d.pairing_code}</strong>
                        <small>
                          Заявка до{' '}
                          {new Date(d.pending_until).toLocaleTimeString('ru-RU', {
                            timeZone: 'Europe/Moscow',
                          })}{' '}
                          МСК. Сверьте код на устройстве.
                        </small>
                      </>
                    ) : (
                      <>
                        <p>
                          {d.state === 'revoked'
                            ? 'Доступ отозван'
                            : !d.online
                              ? 'Нет свежей связи'
                              : d.healthy
                                ? 'Мониторинг и звук готовы'
                                : 'Требуется проверка звука / мониторинга'}
                        </p>
                        <small>
                          {d.last_seen_at
                            ? 'Связь: ' +
                              new Date(d.last_seen_at).toLocaleString('ru-RU', {
                                timeZone: 'Europe/Moscow',
                              })
                            : 'Ещё не подключалось'}
                          {d.app_version && ' · ' + d.app_version}
                        </small>
                        {d.online && (
                          <small>
                            Мониторинг: {d.monitoring ? 'включён' : 'выключен'} · звук:{' '}
                            {d.audio_ready ? 'готов' : 'не готов'} ·{' '}
                            {d.app_version === 'web'
                              ? 'громкость устройства неизвестна'
                              : 'громкость будильника: ' + d.volume + '%'}
                          </small>
                        )}
                      </>
                    )}
                  </div>
                  {d.state !== 'revoked' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title:
                            d.state === 'pending'
                              ? 'Подтвердить устройство?'
                              : 'Отозвать устройство?',
                          description:
                            d.state === 'pending'
                              ? `«${d.label}». Сверьте код ${d.pairing_code} на планшете. Подтверждение действует для этого бизнеса.`
                              : `«${d.label}». Заказы и фоновый мониторинг станут недоступны сразу после отзыва.`,
                          path: '/owner/kitchen-devices/' + d.id,
                          body: { action: d.state === 'pending' ? 'approve' : 'revoke' },
                        })
                      }
                    >
                      {d.state === 'pending' ? 'Подтвердить' : 'Отозвать'}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {secret && (
        <section className="panel temporary-password" role="status">
          <h3>Пароль точки — показан один раз</h3>
          <p>
            Сохраните в защищённом месте. Это общий пароль кухни; менять его может только владелец.
          </p>
          <code>{secret}</code>
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() => {
                if (typeof navigator.clipboard?.writeText !== 'function') {
                  setError(
                    'Браузер не разрешает копирование. Выделите пароль и сохраните его вручную.',
                  );
                  return;
                }
                void navigator.clipboard.writeText(secret).catch((e) => setError(errorMessage(e)));
              }}
            >
              Скопировать
            </button>
            <button
              className="button"
              onClick={() => {
                setSecret('');
                setError('');
              }}
            >
              Я сохранил пароль
            </button>
          </div>
        </section>
      )}
      {error && <Notice>{error}</Notice>}
      {editing && (
        <Modal title="Общий логин точки" close={() => setEditing(null)} guard busy={busy}>
          <form onSubmit={save}>
            <p>{editing.settings.address}</p>
            <label>
              Логин
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={60}
                autoComplete="off"
                pattern="[a-z0-9][a-z0-9_.-]{2,59}"
              />
            </label>
            <p>
              При сохранении общий доступ включится, а прежние входы этой точки завершатся. При
              создании пароль будет показан один раз.
            </p>
            <button className="button" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} close={() => setConfirm(null)} busy={busy}>
          <p>{confirm.description}</p>
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (action)
                  void action(
                    confirm.path,
                    {
                      method: confirm.path.includes('/kitchen-devices/') ? 'POST' : 'PUT',
                      body: json(confirm.body),
                    },
                    done,
                  );
              }}
            >
              Подтвердить
            </button>
            <button className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
