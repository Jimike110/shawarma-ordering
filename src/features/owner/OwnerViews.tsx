import { useOwnerWorkspace } from '@/features/owner/ownerContext';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, MapPin, Search, Users } from 'lucide-react';
import { IntakeState } from '@/features/owner/OwnerUi';
import { type Store } from '@/shared/api/types';

export function StoreRow({
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
          <div
            key={key}
            className={key === 'overdue' && s.counts?.[key] ? 'owner-overdue' : ''}
          >
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

export function Attention({ stores }: { stores: Store[] }) {
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
                  {privacy.map((s) => s.settings.address).join(' · ')} — новые заказы
                  заблокированы.
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
                {s.owner_stopped ? 'Управлять точкой' : 'Открыть кухню'}{' '}
                <ArrowRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SearchField({
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

export function Empty({ text, staff = false }: { text: string; staff?: boolean }) {
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
