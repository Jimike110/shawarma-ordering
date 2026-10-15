import { useOwnerDraft } from '../ownerContext';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage, json } from '../api';
import { Notice } from '../ui';
import type { Operator, PrivacyDocument } from '../privacy';
import type { Store } from '../types';
import { Modal } from './OwnerForms';
import { Subnav } from './Owner';
import { OwnerLoading } from '../ownerWorkspace';

interface PrivacyState {
  draft: Operator;
  revision: number;
  current: PrivacyDocument | null;
  retention_enabled: boolean;
  last_maintenance_at: string | null;
  preview_policy: string;
  preview_consent: string;
}
interface Retention {
  enabled: boolean;
  personal_fields: number;
  receipts: number;
  disabled_staff: number;
  historical_references: number;
  security_counters: number;
  audit_records: number;
  evidence: number;
  requests: number;
}
interface RequestRecord {
  id: number;
  order_id: number | null;
  order_number: number | null;
  kind: string;
  status: string;
  verification: string;
  created_at: string;
}
const fields: {
  key: Exclude<keyof Operator, 'approved' | 'kind'>;
  label: string;
  hint?: string;
  long?: boolean;
}[] = [
  { key: 'legal_name', label: 'Полное наименование организации / ФИО ИП' },
  { key: 'inn', label: 'ИНН' },
  { key: 'registration', label: 'ОГРН / ОГРНИП' },
  { key: 'address', label: 'Адрес оператора' },
  { key: 'contact', label: 'Email для обращений' },
  {
    key: 'contractors',
    label: 'Обработчики и услуги',
    hint: 'Юридические наименования, услуги, категории данных и основание передачи. Укажите всех провайдеров приложения, БД, логов и копий.',
    long: true,
  },
  {
    key: 'locations',
    label: 'Места обработки и хранения',
    hint: 'Страны и площадки приложения, БД, журналов и резервных копий. Не указывайте Россию без проверки фактических размещений.',
    long: true,
  },
  {
    key: 'staff_basis',
    label: 'Основания обработки данных сотрудников',
    hint: 'Утверждённые оператором основания, цели, категории и доступ сотрудников. Обязательные кадровые архивы ведутся отдельно.',
    long: true,
  },
];
const kinds: Record<string, string> = {
  access: 'Доступ',
  correction: 'Исправление',
  withdrawal: 'Отзыв согласия',
  erasure: 'Удаление',
  dispute: 'Спорные данные',
};
const statuses: Record<string, string> = {
  received: 'Получено',
  verified: 'Принадлежность проверена',
  resolved: 'Завершено',
};

export function OwnerPrivacy() {
  const [params, setParams] = useSearchParams();
  const section = params.get('section') ?? 'documents';
  const [state, setState] = useState<PrivacyState | null>(null);
  const [draft, setDraft] = useState<Operator | null>(null);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [moreRequests, setMoreRequests] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false),
    [password, setPassword] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [orderId, setOrderId] = useState(''),
    [storeId, setStoreId] = useState(''),
    [kind, setKind] = useState('access');
  const [selected, setSelected] = useState<number | null>(null);
  const [caseRecord, setCaseRecord] = useState<RequestRecord | null>(null);
  const pendingAction = useRef<(() => Promise<void>) | null>(null);
  const [verification, setVerification] = useState('personal_link_and_purchase');
  const [name, setName] = useState(''),
    [note, setNote] = useState('');
  const dirty = !!state && JSON.stringify(draft) !== JSON.stringify(state.draft);
  useOwnerDraft(dirty || !!name || !!note || !!orderId);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<PrivacyState>('/owner/privacy', { signal: controller.signal }),
      api<Retention>('/owner/privacy/retention', { signal: controller.signal }),
      api<Store[]>('/owner/stores', { signal: controller.signal }),
    ])
      .then(([s, r, points]) => {
        setState(s);
        setDraft(s.draft);
        setRetention(r);
        setStores(points);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'reauthentication_required') {
        pendingAction.current = action;
        setNeedsPassword(true);
        setPassword('');
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    const [s, r] = await Promise.all([
      api<PrivacyState>('/owner/privacy'),
      api<Retention>('/owner/privacy/retention'),
    ]);
    setState(s);
    setDraft(s.draft);
    setRetention(r);
    setReviewed(false);
  }
  async function loadRequests() {
    const records = await api<RequestRecord[]>('/owner/privacy/requests');
    setRequests(records);
    setMoreRequests(records.length === 200);
  }
  async function olderRequests() {
    const records = await api<RequestRecord[]>(
      '/owner/privacy/requests?before=' + requests.at(-1)!.id,
    );
    setRequests((previous) => [...previous, ...records]);
    setMoreRequests(records.length === 200);
  }
  async function downloadDestructions() {
    let after = '';
    const pages: unknown[] = [];
    do {
      const page = await api<{ next_after: string }>(
        '/owner/privacy/destructions' + (after ? '?after=' + after : ''),
      );
      pages.push(page);
      after = page.next_after;
    } while (after);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pages, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'destruction-log.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      'Выгрузка скачана. Ответственные оформляют и подписывают отдельный акт уничтожения; комплект хранится три года.',
    );
  }
  async function requestAction(action: string) {
    if (!selected) return;
    const record = activeRequest;
    const result = await api<unknown>('/owner/privacy/requests/' + selected, {
      method: 'POST',
      body: json({ action, verification, name, note }),
    });
    if (action === 'export') {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'privacy-request-' + selected + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        'Экспорт скачан. Передайте его только проверенному заявителю и удалите рабочую копию после ответа.',
      );
    } else setMessage('Действие выполнено. Содержимое персональных полей не копируется в аудит.');
    setName('');
    setNote('');
    if (record)
      setCaseRecord({
        ...record,
        status:
          action === 'verify' ? 'verified' : action === 'resolve' ? 'resolved' : record.status,
      });
    await loadRequests();
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const s = await api<PrivacyState>('/owner/privacy/draft', {
        method: 'PUT',
        body: json({ draft, revision: state!.revision }),
      });
      setState(s);
      setDraft(s.draft);
      setMessage('Черновик сохранён. Опубликованные документы не изменились.');
    });
  }
  const activeRequest =
    requests.find((r) => r.id === selected) ??
    (caseRecord?.id === selected ? caseRecord : undefined);
  return (
    <div className="owner-page privacy-workspace">
      <h1>Персональные данные</h1>
      <p className="owner-scope-label">
        Для всего бизнеса · документы и обращения одного оператора
      </p>
      <Subnav
        values={[
          ['documents', 'Документы'],
          ['requests', 'Обращения'],
          ['retention', 'Сроки и очистка'],
        ]}
        value={section}
        change={(v) => {
          const p = new URLSearchParams(params);
          p.set('section', v);
          setParams(p);
        }}
      />
      <Notice kind="warning">
        Публикация настраивает документы сервиса. До работы с реальными данными отдельно проверьте
        российское размещение приложения, БД, журналов и копий, договоры и меры защиты. Публикация
        документов не подтверждает размещение и защищённость инфраструктуры.
      </Notice>
      {error && <Notice>{error}</Notice>}
      {message && <p role="status">{message}</p>}
      {!state && !error && <OwnerLoading />}
      {needsPassword && (
        <Modal
          title="Подтвердите пароль"
          close={() => {
            if (!busy) {
              setNeedsPassword(false);
              setPassword('');
              pendingAction.current = null;
            }
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/auth/reauthenticate', { method: 'POST', body: json({ password }) });
                setPassword('');
                setNeedsPassword(false);
                const action = pendingAction.current;
                pendingAction.current = null;
                await action?.();
              });
            }}
          >
            <p>
              Для действий с документами и персональными данными нужно подтверждение за последние 5
              минут.
            </p>
            <label>
              Текущий пароль
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={128}
              />
            </label>
            {error && <Notice>{error}</Notice>}
            <button className="button" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </Modal>
      )}
      {state && draft && (
        <>
          <form hidden={section !== 'documents'} className="panel privacy-section" onSubmit={save}>
            <h2>Оператор и черновик</h2>
            <p className="owner-draft-state" role="status">
              {dirty
                ? 'Есть несохранённые изменения'
                : 'Черновик сохранён · версия ' + state.revision}
            </p>
            <p>
              Реквизиты компании или ИП, а не название заведения. Пустые поля не заполняются
              автоматически.
            </p>
            <label>
              Тип оператора
              <select
                value={draft.kind || ''}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value, approved: false })}
              >
                <option value="">Выберите</option>
                <option value="company">Организация</option>
                <option value="ip">Индивидуальный предприниматель</option>
              </select>
            </label>
            {[
              {
                title: 'Реквизиты оператора',
                keys: ['legal_name', 'inn', 'registration', 'address', 'contact'],
              },
              { title: 'Обработчики и размещение', keys: ['contractors', 'locations'] },
              { title: 'Данные сотрудников', keys: ['staff_basis'] },
            ].map((group) => (
              <fieldset key={group.title}>
                <legend>{group.title}</legend>
                <div className="privacy-form-grid">
                  {fields
                    .filter((f) => group.keys.includes(f.key))
                    .map((f) => (
                      <label key={f.key} className={f.long ? 'wide' : ''}>
                        {f.label}
                        {f.long ? (
                          <textarea
                            value={draft[f.key] || ''}
                            maxLength={3000}
                            rows={3}
                            onChange={(e) =>
                              setDraft({ ...draft, [f.key]: e.target.value, approved: false })
                            }
                          />
                        ) : (
                          <input
                            type={f.key === 'contact' ? 'email' : 'text'}
                            value={draft[f.key] || ''}
                            maxLength={3000}
                            onChange={(e) =>
                              setDraft({ ...draft, [f.key]: e.target.value, approved: false })
                            }
                          />
                        )}
                        {f.hint && <small>{f.hint}</small>}
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
            <label className="privacy-check">
              <input
                type="checkbox"
                checked={!!draft.approved}
                onChange={(e) => setDraft({ ...draft, approved: e.target.checked })}
              />
              <span>
                Оператор утвердил реквизиты, получателей, основания, тексты и сроки, включая
                трёхлетний срок минимальных доказательств.
              </span>
            </label>
            <button className="button" disabled={busy}>
              Сохранить черновик
            </button>
          </form>
          <section hidden={section !== 'documents'} className="panel privacy-section">
            <h2>Публикация</h2>
            <p>
              {state.current
                ? 'Опубликована версия №' + state.current.id
                : 'Документы не опубликованы — новые заказы заблокированы.'}
            </p>
            <p>
              Просмотрите сохранённый черновик перед публикацией. Каждая публикация создаёт
              неизменяемую версию; новая версия потребует обновить оформление заказа.
            </p>
            <details>
              <summary>Политика · сохранённый черновик</summary>
              <div className="privacy-document">{state.preview_policy}</div>
            </details>
            <details>
              <summary>Отдельное согласие · сохранённый черновик</summary>
              <div className="privacy-document">{state.preview_consent}</div>
            </details>
            <button
              className="button"
              disabled={busy || JSON.stringify(draft) !== JSON.stringify(state.draft)}
              onClick={() =>
                void run(async () => {
                  await api('/owner/privacy/publish', {
                    method: 'POST',
                    body: json({ revision: state.revision }),
                  });
                  await reload();
                  setMessage('Новая версия опубликована.');
                })
              }
            >
              Опубликовать сохранённую версию
            </button>
            {state.current && (
              <p>
                <Link to={'/privacy?version=' + state.current.id}>Опубликованная политика</Link> ·{' '}
                <Link to={'/consent?version=' + state.current.id}>Согласие</Link>
              </p>
            )}
          </section>
          <section hidden={section !== 'retention'} className="panel privacy-section">
            <h2>Сроки и очистка</h2>
            <button
              className="text-link"
              disabled={busy}
              onClick={() => void run(downloadDestructions)}
            >
              Скачать журнал для акта уничтожения
            </button>
            <p>
              7 дней — необязательные поля; год — квитанция; 90 дней — данные отключённого
              сотрудника. Активные заказы сохраняются. Очистку запускает отдельное почасовое
              задание, не загрузка этой страницы.
            </p>
            {retention && (
              <>
                <dl className="privacy-counts">
                  <div>
                    <dt>Необязательные поля к удалению</dt>
                    <dd>{retention.personal_fields}</dd>
                  </div>
                  <div>
                    <dt>Квитанции к истечению</dt>
                    <dd>{retention.receipts}</dd>
                  </div>
                  <div>
                    <dt>Отключённые сотрудники</dt>
                    <dd>{retention.disabled_staff}</dd>
                  </div>
                  <div>
                    <dt>Заказы с исторической датой отсчёта</dt>
                    <dd>{retention.historical_references}</dd>
                  </div>
                </dl>
                <p>
                  Очистка {retention.enabled ? 'активирована' : 'не активирована'}. Последний
                  запуск:{' '}
                  {state.last_maintenance_at
                    ? new Date(state.last_maintenance_at).toLocaleString('ru-RU', {
                        timeZone: 'Europe/Moscow',
                      }) + ' МСК'
                    : 'ещё не выполнялся'}
                  .
                </p>
                <label className="privacy-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  <span>
                    Я просмотрел объём удаления; настроены защищённый внешний журнал, почасовой
                    запуск и срок копий не более 14 дней.
                  </span>
                </label>
                <div className="privacy-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void run(reload)}
                  >
                    Обновить объём
                  </button>
                  <button
                    className="button"
                    disabled={busy || !reviewed || !state.current}
                    onClick={() =>
                      void run(async () => {
                        await api('/owner/privacy/retention', {
                          method: 'POST',
                          body: json({ enabled: !retention.enabled, previewed: reviewed }),
                        });
                        await reload();
                        setMessage('Настройка очистки обновлена.');
                      })
                    }
                  >
                    {retention.enabled ? 'Приостановить очистку' : 'Активировать очистку'}
                  </button>
                </div>
              </>
            )}
          </section>
          <section hidden={section !== 'requests'} className="panel privacy-section">
            <h2>Обращения гостей</h2>
            <p>
              Принимайте обращения по опубликованному контакту. Проверяйте принадлежность
              соразмерно; не загружайте паспорта. Не копируйте текст обращения или контакт заявителя
              сюда: сохраните их в защищённой системе оператора.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const created = await api<{ id: number }>('/owner/privacy/requests', {
                    method: 'POST',
                    body: json({ store_id: Number(storeId), order_number: Number(orderId), kind }),
                  });
                  setSelected(created.id);
                  setOrderId('');
                  await loadRequests();
                  setMessage(
                    'Обращение зарегистрировано. Перед действиями подтвердите принадлежность данных.',
                  );
                });
              }}
            >
              <div className="privacy-form-grid">
                <label>
                  Точка получения
                  <select required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">Выберите точку</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.settings.address || s.settings.shop_name}
                        {s.archived ? ' · архив' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Номер заказа
                  <input
                    inputMode="numeric"
                    type="number"
                    min="1"
                    required
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                  />
                </label>
                <label>
                  Вид обращения
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {Object.entries(kinds).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="button secondary" disabled={busy}>
                Зарегистрировать
              </button>
            </form>
            <button className="text-link" disabled={busy} onClick={() => void run(loadRequests)}>
              Загрузить обращения
            </button>
            {moreRequests && (
              <button className="text-link" disabled={busy} onClick={() => void run(olderRequests)}>
                Более ранние обращения
              </button>
            )}
            {requests.length > 0 && (
              <label>
                Обращение
                <select
                  value={selected ?? ''}
                  onChange={(e) => {
                    setSelected(Number(e.target.value));
                    setName('');
                    setNote('');
                  }}
                >
                  <option value="">Выберите</option>
                  {requests.map((r) => (
                    <option key={r.id} value={r.id}>
                      №{r.id} · {kinds[r.kind]} · {statuses[r.status]} · заказ{' '}
                      {r.order_number ?? 'удалён'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {activeRequest && activeRequest.status !== 'resolved' && (
              <div className="privacy-case">
                <label>
                  Способ проверки
                  <select value={verification} onChange={(e) => setVerification(e.target.value)}>
                    <option value="personal_link_and_purchase">
                      Личная ссылка и детали покупки
                    </option>
                    <option value="in_person">Проверка на месте</option>
                    <option value="existing_contact">Известный оператору контакт</option>
                  </select>
                </label>
                <div className="privacy-actions">
                  <button
                    className="button secondary"
                    disabled={busy || activeRequest.status === 'verified'}
                    onClick={() => void run(() => requestAction('verify'))}
                  >
                    Подтвердить принадлежность
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || activeRequest.status !== 'verified'}
                    onClick={() => void run(() => requestAction('export'))}
                  >
                    Скачать данные
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || activeRequest.status !== 'verified'}
                    onClick={() => void run(() => requestAction('block'))}
                  >
                    Блокировать спорные поля
                  </button>
                </div>
                <details>
                  <summary>Исправить необязательные поля</summary>
                  <p className="fine-print">
                    Только при действующем согласии. Не вводите специальные категории или чужие
                    данные.
                  </p>
                  <label>
                    Исправленное имя
                    <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label>
                    Исправленный комментарий
                    <textarea
                      value={note}
                      maxLength={500}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy || activeRequest.status !== 'verified'}
                    onClick={() => void run(() => requestAction('correct'))}
                  >
                    Исправить и снять блокировку
                  </button>
                </details>
                <details>
                  <summary>Удаление и завершение</summary>
                  <p>
                    Удаление очистит имя, комментарий и свободный текст отмены, сохранив заказ.
                    Действие необратимо. Ответ заявителю отправьте отдельно, затем завершите
                    обращение.
                  </p>
                  <div className="privacy-actions">
                    <button
                      className="button danger"
                      disabled={busy || activeRequest.status !== 'verified'}
                      onClick={() => void run(() => requestAction('erase'))}
                    >
                      Подтверждаю удаление полей
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || activeRequest.status !== 'verified'}
                      onClick={() => void run(() => requestAction('resolve'))}
                    >
                      Завершить обращение
                    </button>
                  </div>
                </details>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
