import { Trash2 } from 'lucide-react';
import {
  cartCount,
  invalidLine,
  lineKey,
  MAX_ITEMS,
  optionLabels,
  unitPrice,
  useCart,
} from '@/features/cart/cart';
import { rub } from '@/shared/lib/format';
import { type Product } from '@/shared/api/types';
import { Quantity } from '@/shared/ui/Quantity';
import { FoodImage } from '@/shared/ui/FoodImage';

export function CartItems({
  products,
  accepting,
  busy = false,
}: {
  products: Product[];
  accepting: boolean;
  busy?: boolean;
}) {
  const { lines, setQuantity } = useCart();
  const remaining = MAX_ITEMS - cartCount(lines);
  return (
    <div className="cart-lines">
      {lines.map((line) => {
        const p = products.find((p) => p.id === line.product_id),
          invalid = invalidLine(line, products);
        return (
          <div className="cart-line" key={lineKey(line)}>
            {p && <FoodImage src={p.image} alt="" />}
            <div className="cart-line-copy">
              <b>{p?.name ?? 'Товар удалён'}</b>
              {line.options?.length ? <small>{optionLabels(line, p)}</small> : null}
              <span>{p ? rub(unitPrice(line, p) * line.quantity) : 'Недоступен'}</span>
              {invalid && (
                <small className="text-error">
                  Товар или опция недоступны — удалите позицию
                </small>
              )}
            </div>
            <div className="cart-line-actions">
              <Quantity
                value={line.quantity}
                disabled={busy}
                canIncrease={accepting && !invalid}
                max={Math.min(20, line.quantity + remaining)}
                onChange={(n) => setQuantity(line.product_id, n, line.options)}
                name={p?.name ?? 'Товар'}
              />
              <button
                className="remove-line"
                type="button"
                disabled={busy}
                aria-label={'Удалить: ' + (p?.name ?? 'Товар')}
                onClick={() => setQuantity(line.product_id, 0, line.options)}
              >
                <Trash2 size={14} /> Удалить
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
