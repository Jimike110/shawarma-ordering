import { useStaffStore } from '@/features/auth/storeContext';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage, json } from '@/shared/api/client';
import { Notice } from '@/shared/ui/Feedback';
import { randomKey } from '@/shared/lib/requestKey';
import { type Product } from '@/shared/api/types';

export function ProductEditor({
  product,
  done,
  expired,
}: {
  product: Product;
  done: () => void;
  expired: () => void;
}) {
  const { request: api } = useStaffStore();
  const [value, setValue] = useState({
    ...product,
    ingredients: product.ingredients ?? '',
    allergens: product.allergens ?? '',
    options: product.options ?? [],
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(product.id ? '/kitchen/products/' + product.id : '/kitchen/products', {
        method: product.id ? 'PUT' : 'POST',
        body: json(value),
      });
      done();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel product-editor" onSubmit={submit}>
      <fieldset className="form-fields" disabled={busy}>
        <h2>{product.id ? 'Редактировать товар' : 'Новый товар'}</h2>
        <label>
          Название
          <input
            value={value.name}
            maxLength={100}
            required
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          Описание
          <textarea
            value={value.description}
            maxLength={600}
            rows={3}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Цена, ₽
            <input
              type="number"
              min={1}
              max={1000000}
              required
              value={value.price}
              onChange={(e) => setValue({ ...value, price: Number(e.target.value) })}
            />
          </label>
          <label>
            Вес / объём
            <input
              maxLength={40}
              value={value.weight}
              onChange={(e) => setValue({ ...value, weight: e.target.value })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Категория
            <input
              maxLength={100}
              required
              value={value.category}
              onChange={(e) => setValue({ ...value, category: e.target.value })}
            />
          </label>
          <label>
            Порядок
            <input
              type="number"
              min={0}
              max={10000}
              value={value.sort_order}
              onChange={(e) => setValue({ ...value, sort_order: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Фото: путь /images/... или HTTPS
          <input
            maxLength={1000}
            required
            value={value.image}
            onChange={(e) => setValue({ ...value, image: e.target.value })}
          />
        </label>
        <label>
          Состав
          <textarea
            rows={3}
            maxLength={600}
            value={value.ingredients}
            onChange={(e) => setValue({ ...value, ingredients: e.target.value })}
            placeholder="Укажите полный состав"
          />
        </label>
        <label>
          Аллергены
          <textarea
            rows={2}
            maxLength={300}
            value={value.allergens}
            onChange={(e) => setValue({ ...value, allergens: e.target.value })}
            placeholder="Только подтверждённые сведения"
          />
        </label>
        <fieldset className="option-editor">
          <legend>Опции товара</legend>
          <p className="muted">Дополнения с ценой или бесплатные изменения. До 12 опций.</p>
          {value.options.map((option, index) =>
            option.topping_id ? (
              <p key={option.id}>{option.label} · Управление в разделе «Добавки и соусы»</p>
            ) : (
              <div className="option-editor-row" key={option.id}>
                <label>
                  Название опции
                  <input
                    required
                    maxLength={80}
                    value={option.label}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        options: value.options.map((o, i) =>
                          i === index ? { ...o, label: e.target.value } : o,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Доплата, ₽
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={option.price}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        options: value.options.map((o, i) =>
                          i === index ? { ...o, price: Number(e.target.value) } : o,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="remove-line"
                  type="button"
                  aria-label={'Удалить опцию ' + (option.label || index + 1)}
                  onClick={() =>
                    setValue({ ...value, options: value.options.filter((_, i) => i !== index) })
                  }
                >
                  Удалить
                </button>
              </div>
            ),
          )}
          <button
            type="button"
            className="button secondary small"
            disabled={value.options.length >= 12}
            onClick={() =>
              setValue({
                ...value,
                options: [
                  ...value.options,
                  { id: 'opt-' + randomKey().slice(0, 12), label: '', price: 0 },
                ],
              })
            }
          >
            Добавить опцию
          </button>
        </fieldset>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.available}
            onChange={(e) => setValue({ ...value, available: e.target.checked })}
          />{' '}
          Доступен для заказа
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="form-row">
          <button type="button" className="button secondary" onClick={done}>
            Закрыть
          </button>
          <button className="button">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </fieldset>
    </form>
  );
}
