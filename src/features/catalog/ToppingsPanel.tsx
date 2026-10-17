import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage, json } from '@/shared/api/client';
import { useStaffStore } from '@/features/auth/storeContext';
import { usePolling } from '@/shared/hooks/usePolling';
import { Notice } from '@/shared/ui/Feedback';
import { rub } from '@/shared/lib/format';
import { type Product } from '@/shared/api/types';
import { KitchenDialog } from '@/shared/ui/KitchenDialog';

interface Topping {
  id: number;
  name: string;
  description: string;
  image: string;
  ingredients: string;
  allergens: string;
  available: boolean;
  extra_price: number;
  extra_portion: string;
  standalone_price: number;
  standalone_portion: string;
  standalone_product_id: number;
  product_ids: number[];
}

type ToppingDraft = Omit<Topping, 'extra_price' | 'standalone_price'> & {
  extra_price: number | '';
  standalone_price: number | '';
};

const empty: ToppingDraft = {
  id: 0,
  name: '',
  description: '',
  image: '/images/placeholder.svg',
  ingredients: '',
  allergens: '',
  available: false,
  extra_price: '',
  extra_portion: '',
  standalone_price: '',
  standalone_portion: '',
  standalone_product_id: 0,
  product_ids: [],
};

export function ToppingsPanel({ products, saved }: { products: Product[]; saved: () => void }) {
  const { request, role } = useStaffStore();
  const load = useCallback(
    (signal: AbortSignal) => request<Topping[]>('/kitchen/toppings', { signal }),
    [request],
  );
  const data = usePolling(load, 15000);
  const [editing, setEditing] = useState<ToppingDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(value: Partial<ToppingDraft>) {
    if (editing) {
      setEditing({ ...editing, ...value });
      setDirty(true);
    }
  }
  function close() {
    if (!busy && (!dirty || window.confirm('Закрыть без сохранения добавки?'))) {
      setEditing(null);
      setDirty(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/kitchen/toppings' + (editing.id ? '/' + editing.id : ''), {
        method: editing.id ? 'PUT' : 'POST',
        body: json(editing),
      });
      setEditing(null);
      setDirty(false);
      setNotice('Добавка сохранена. Отдельная позиция и добавки в блюдах обновлены.');
      data.refresh();
      saved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(t: Topping) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/kitchen/toppings/' + t.id + '/availability', {
        method: 'PATCH',
        body: json({ available: !t.available }),
      });
      data.refresh();
      saved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(t: Topping) {
    if (
      busy ||
      !window.confirm(
        `Удалить «${t.name}» из отдельной продажи и из всех блюд этой точки? Старые чеки сохранятся.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/kitchen/products/' + t.standalone_product_id, { method: 'DELETE' });
      data.refresh();
      saved();
      setNotice('Добавка удалена.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel toppings-panel">
      <div className="section-top">
        <h2>Добавки и соусы</h2>
        {role !== 'worker' && (
          <button
            className="button secondary"
            onClick={() => {
              setEditing({ ...empty, product_ids: [] });
              setDirty(false);
              setError('');
            }}
          >
            Новая добавка
          </button>
        )}
      </div>
      <p>
        Одна доступность для блюда и отдельной продажи. Порция добавки умножается на количество
        блюд.
      </p>
      {notice && <Notice kind="success">{notice}</Notice>}
      {!editing && error && <Notice>{error}</Notice>}
      {data.error && <Notice>{data.error}</Notice>}
      {data.loading && !data.data && <p role="status">Загружаем добавки…</p>}
      {data.data?.length === 0 && (
        <p>Каталог добавок пока пуст. Существующие опции блюд продолжают работать отдельно.</p>
      )}
      {data.data?.map((t) => (
        <article className="topping-row" key={t.id}>
          <div>
            <h3>{t.name}</h3>
            <p>
              В блюдо: {rub(t.extra_price)}
              {t.extra_portion && ` / ${t.extra_portion}`} · Отдельно: {rub(t.standalone_price)}
              {t.standalone_portion && ` / ${t.standalone_portion}`}
            </p>
            <small>Блюд: {t.product_ids.length}</small>
          </div>
          <div className="form-actions">
            <button
              className="button secondary"
              role="switch"
              aria-checked={t.available}
              aria-label={'Доступность добавки ' + t.name}
              disabled={busy}
              onClick={() => void toggle(t)}
            >
              {t.available ? 'В продаже' : 'Недоступна'}
            </button>
            {role !== 'worker' && (
              <>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(t);
                    setDirty(false);
                    setError('');
                  }}
                >
                  Изменить добавку
                </button>
                <button
                  className="button secondary text-error"
                  disabled={busy}
                  onClick={() => void remove(t)}
                >
                  Удалить добавку
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {editing && (
        <KitchenDialog
          title={editing.id ? 'Изменить добавку' : 'Новая добавка'}
          close={close}
          busy={busy}
        >
          <form onSubmit={save}>
            <fieldset disabled={busy} className="form-fields">
              <label>
                Название
                <input
                  required
                  value={editing.name}
                  maxLength={80}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label>
                Описание
                <textarea
                  value={editing.description}
                  maxLength={600}
                  onChange={(e) => change({ description: e.target.value })}
                />
              </label>
              <label>
                Фото
                <input
                  required
                  value={editing.image}
                  maxLength={1000}
                  onChange={(e) => change({ image: e.target.value })}
                />
              </label>
              <label>
                Состав
                <textarea
                  value={editing.ingredients}
                  maxLength={600}
                  onChange={(e) => change({ ingredients: e.target.value })}
                />
              </label>
              <label>
                Аллергены
                <textarea
                  value={editing.allergens}
                  maxLength={300}
                  onChange={(e) => change({ allergens: e.target.value })}
                />
              </label>
              <p className="fine-print">
                Неизвестные сведения оставьте пустыми. Не определяйте состав по фотографии.
              </p>
              <div className="form-row">
                <label>
                  Цена в блюдо, ₽
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={editing.extra_price}
                    onChange={(e) =>
                      change({
                        extra_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Порция в блюдо
                  <input
                    maxLength={40}
                    value={editing.extra_portion}
                    onChange={(e) => change({ extra_portion: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Цена отдельно, ₽
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    required
                    value={editing.standalone_price}
                    onChange={(e) =>
                      change({
                        standalone_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Порция отдельно
                  <input
                    maxLength={40}
                    value={editing.standalone_portion}
                    onChange={(e) => change({ standalone_portion: e.target.value })}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={editing.available}
                  onChange={(e) => change({ available: e.target.checked })}
                />
                Доступна в обоих вариантах
              </label>
              <fieldset>
                <legend>Предлагать в блюдах</legend>
                {products
                  .filter((p) => !p.topping_id)
                  .map((p) => (
                    <label className="check-label" key={p.id}>
                      <input
                        type="checkbox"
                        checked={editing.product_ids.includes(p.id)}
                        onChange={(e) =>
                          change({
                            product_ids: e.target.checked
                              ? [...editing.product_ids, p.id]
                              : editing.product_ids.filter((id) => id !== p.id),
                          })
                        }
                      />
                      {p.name}
                    </label>
                  ))}
              </fieldset>
              <p>
                Отдельная позиция появится в категории «Добавки и соусы». Удаление этой позиции
                удаляет добавку из блюд; старые чеки сохраняются.
              </p>
              {error && <Notice>{error}</Notice>}
              <button className="button" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить добавку'}
              </button>
            </fieldset>
          </form>
        </KitchenDialog>
      )}
    </section>
  );
}
