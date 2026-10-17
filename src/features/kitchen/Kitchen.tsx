import { useAuth } from '@/features/auth/authContext';
import { nativeKitchenAction, useNativeKitchen } from '@/features/kitchen/nativeKitchen';
import { useKitchenHealth } from '@/features/kitchen/useKitchenHealth';
import { KitchenBoard } from '@/features/kitchen/KitchenBoard';
import { ToppingsPanel } from '@/features/catalog/ToppingsPanel';
import '@/features/kitchen/kitchen.css';
import { useStaffStore } from '@/features/auth/storeContext';
import { WorkerSettings } from '@/features/kitchen/WorkerSettings';
import { useKitchenSound } from '@/features/kitchen/useKitchenSound';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pause,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  Trash2,
  Flame,
} from 'lucide-react';
import { ApiError, errorMessage, json } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { FoodImage } from '@/shared/ui/FoodImage';
import { Notice } from '@/shared/ui/Feedback';
import { useMenu } from '@/features/catalog/MenuProvider';
import { clock, rub } from '@/shared/lib/format';
import { type Order, type Product } from '@/shared/api/types';
import { Link } from 'react-router-dom';
import { PauseDialog } from '@/features/kitchen/PauseDialog';
import { OrderCard } from '@/features/kitchen/OrderCard';
import { DeleteProductDialog } from '@/features/catalog/DeleteProductDialog';
import { ProductEditor } from '@/features/catalog/ProductEditor';
import { SettingsForm } from '@/features/stores/SettingsForm';

function KitchenControls({
  children,
  section,
}: {
  children: ReactNode;
  section: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [section]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <details
      className="kitchen-controls"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label="Управление кухней">
        <SlidersHorizontal size={21} />
      </summary>
      <div className="kitchen-controls-menu">{children}</div>
    </details>
  );
}

export function Kitchen({ accountMenu }: { accountMenu?: ReactNode }) {
  const { invalidate, user } = useAuth();
  const { request: api, role, id: storeId } = useStaffStore();
  const auth = true;
  const setAuth = (_: boolean) => invalidate();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('orders'),
    [filter, setFilter] = useState('active');
  const [pauseDialog, setPauseDialog] = useState(false),
    [pauseReason, setPauseReason] = useState('');
  const [editing, setEditing] = useState<Product | null>(null),
    [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<Product | null>(null),
    [menuNotice, setMenuNotice] = useState('');
  const native = useNativeKitchen();
  const sound = useKitchenSound(native.native);
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await api<Order[]>('/kitchen/orders', { signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setAuth(false);
        throw e;
      }
    },
    [api, invalidate],
  );
  const queue = usePolling(loadOrders, 5000, auth === true),
    menu = useMenu();
  const health = useKitchenHealth(
    user,
    queue.lastUpdated,
    sound.ready,
    sound.enabled,
    native.native,
  );
  useEffect(() => {
    if (!auth || !queue.data) return;
    sound.setPending(queue.data.some((o) => o.status === 'new'));
  }, [queue.data, auth, sound.setPending]);
  const expired = () => setAuth(false);
  const refresh = () => {
    queue.refresh();
    menu.refresh();
  };
  async function togglePause() {
    if (!menu.data || busy) return;
    setBusy(true);
    setError('');
    try {
      const reason = menu.data.settings.paused ? '' : pauseReason;
      if (!menu.data.settings.paused && !reason.trim()) {
        setPauseDialog(true);
        return;
      }
      await api('/kitchen/operations', {
        method: 'PATCH',
        body: json({ paused: !menu.data.settings.paused, reason }),
      });
      setPauseReason('');
      setPauseDialog(false);
      menu.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  async function toggleProduct(product: Product) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/kitchen/products/' + product.id + '/availability', {
        method: 'PATCH',
        body: json({ available: !product.available }),
      });
      menu.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) expired();
    } finally {
      setBusy(false);
    }
  }
  const orders = queue.data ?? [],
    active = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const overdue = active.filter(
    (o) => o.status !== 'ready' && Date.now() > Date.parse(o.estimated_ready_at),
  ).length;
  const visible = (filter === 'active' ? active : orders.filter((o) => o.status === filter))
    .filter((o) =>
      (o.number + ' ' + o.name)
        .toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru')),
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const newOrders = orders.filter((o) => o.status === 'new').length;
  const monitoring = native.native ? native.state.monitoring : sound.enabled;
  const audioReady = native.native ? native.state.audio_ready : sound.ready;
  const showNew = () => {
    setTab('orders');
    setFilter('new');
    setSearch('');
  };
  const intake = !menu.data
    ? 'Подключаемся…'
    : menu.data.store?.owner_stopped
      ? 'Стоп владельца'
      : menu.data.settings.paused
        ? 'Приём на паузе'
        : menu.data.accepting_orders
          ? 'Принимаем заказы'
          : menu.data.intake_message || 'Не принимаем заказы';
  return (
    <main
      className={
        'container kitchen kitchen-tablet' +
        (tab === 'orders' && filter === 'active' ? ' kitchen-board-active' : '')
      }
    >
      <div className="kitchen-operations-header">
        <div className="kitchen-topbar">
          <div className="kitchen-location">
            <div>
              <Link to={'/kitchen'} className="brand">
                <span className="brand-mark">
                  <Flame size={25} />
                </span>
              </Link>
            </div>
            <h1>Кухня</h1>
            <span title={menu.data?.settings.address}>
              {menu.data?.settings.address || 'Подключаемся…'}
            </span>
          </div>
          <button
            className="kitchen-new-count"
            onClick={showNew}
            aria-pressed={tab === 'orders' && filter === 'new'}
          >
            Новые <b>{newOrders}</b>
          </button>
          <select
            className="kitchen-section-select"
            aria-label="Раздел кухни"
            value={tab}
            onChange={(e) => setTab(e.target.value)}
          >
            <option value="orders">Заказы · {active.length}</option>
            <option value="menu">Меню</option>
            <option value="settings">Настройки</option>
          </select>
          <KitchenControls section={tab}>
            <p className="kitchen-control-title">Управление кухней</p>
            <p className="fine-print">{intake}</p>
            <button
              className="button secondary"
              disabled={!menu.data || busy || menu.data.store?.owner_stopped}
              onClick={() => void togglePause()}
            >
              {menu.data?.settings.paused ? <Play size={16} /> : <Pause size={16} />}
              {menu.data?.settings.paused ? 'Возобновить' : 'Пауза'}
            </button>
            <button
              className="button secondary"
              onClick={() => (native.native ? nativeKitchenAction('test') : sound.test())}
            >
              Проверить звук
            </button>
            {native.native && (
              <button
                className="button secondary"
                onClick={() => nativeKitchenAction('settings')}
              >
                Громкость и разрешения
              </button>
            )}
            <p className="fine-print">
              Оповещения повторяются, пока есть новые заказы.{' '}
              {native.native
                ? 'Фоновый мониторинг работает отдельно от страницы.'
                : 'Для фоновых оповещений используйте приложение кухни.'}
            </p>
            {accountMenu}
          </KitchenControls>
        </div>
        <div className="kitchen-statusline">
          <span
            className={'intake-status ' + (!menu.data?.accepting_orders ? 'paused' : '')}
            title={intake}
          >
            <span className="status-dot" />
            <span className="kitchen-intake-label">{intake}</span>
          </span>
          <button
            className="kitchen-sound-status"
            data-kitchen-sound
            onClick={() =>
              native.native
                ? nativeKitchenAction(
                    monitoring && !audioReady ? 'settings' : monitoring ? 'stop' : 'start',
                  )
                : sound.toggle()
            }
            aria-pressed={monitoring}
            aria-label={
              monitoring && audioReady
                ? 'Остановить оповещения'
                : native.native
                  ? monitoring
                    ? 'Громкость и разрешения'
                    : 'Включить уведомления кухни'
                  : 'Активировать звук'
            }
          >
            {monitoring && audioReady ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {monitoring && audioReady
              ? 'Звук включён'
              : native.native && monitoring
                ? 'Проверить звук'
                : 'Включить звук'}
          </button>
          <span
            className="kitchen-connection"
            title={
              queue.lastUpdated
                ? 'Обновлено ' + clock(queue.lastUpdated.toISOString())
                : undefined
            }
          >
            {queue.error ? 'Нет связи' : queue.lastUpdated ? 'На связи' : 'Подключение…'}
          </span>
          <button className="icon-button" aria-label="Обновить кухню" onClick={refresh}>
            <RefreshCw size={18} />
          </button>
        </div>
        {pauseDialog && (
          <PauseDialog
            reason={pauseReason}
            setReason={setPauseReason}
            busy={busy}
            close={() => setPauseDialog(false)}
            submit={() => void togglePause()}
          />
        )}
      </div>
      {health.stale && (
        <Notice kind="warning">
          Нет свежей связи более 15 секунд. Показана последняя очередь; состояние заказов не
          подтверждено. Приём новых заказов продолжается.
        </Notice>
      )}
      {(native.native ? !native.state.monitoring : !sound.enabled) && (
        <Notice kind="warning">
          Оповещения остановлены на этом устройстве. Новые заказы продолжают поступать.
        </Notice>
      )}
      {native.native && native.state.error && (
        <Notice kind="warning">{native.state.error}</Notice>
      )}
      {health.heartbeatError && (
        <Notice kind="warning">
          Не удалось передать состояние устройства владельцу. Проверьте связь.
        </Notice>
      )}
      {!native.native &&
        (sound.error ? (
          <Notice>{sound.error}</Notice>
        ) : (
          sound.enabled &&
          !sound.ready && (
            <p className="fine-print" role="status">
              Звук включён по умолчанию и ожидает первого нажатия на странице.
            </p>
          )
        ))}
      {error && <Notice>{error}</Notice>}
      {queue.error && <Notice>Очередь не обновилась. {queue.error}</Notice>}
      {menu.error && <Notice>Меню не обновилось. {menu.error}</Notice>}
      {tab === 'orders' && (
        <>
          <div className="kitchen-queue-controls">
            <label className="queue-search">
              <span className="sr-only">Найти заказ</span>
              <input
                type="search"
                placeholder="Номер заказа или имя"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Статус заказов"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                ['active', 'В работе · ' + active.length],
                ['new', 'Новые · ' + newOrders],
                [
                  'preparing',
                  'Готовим · ' + orders.filter((o) => o.status === 'preparing').length,
                ],
                ['ready', 'К выдаче · ' + orders.filter((o) => o.status === 'ready').length],
                ['completed', 'Выданы'],
                ['cancelled', 'Отменены'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {overdue > 0 && <span className="text-error">Опаздывают: {overdue}</span>}
          </div>
          {queue.loading && !queue.data ? (
            <p role="status">Загружаем очередь…</p>
          ) : visible.length === 0 && (filter !== 'active' || !!search) ? (
            <div className="panel empty">
              <UtensilsCrossed size={30} />
              <h2>{search ? 'Заказ не найден' : 'Здесь пока тихо'}</h2>
              <p>
                {search
                  ? 'Попробуйте другое имя или номер.'
                  : 'Новые заказы появятся автоматически.'}
              </p>
            </div>
          ) : (
            <KitchenBoard
              orders={visible}
              board={filter === 'active'}
              renderOrder={(order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  reload={queue.refresh}
                  expired={expired}
                />
              )}
            />
          )}
        </>
      )}
      {tab === 'menu' && (
        <>
          <ToppingsPanel products={menu.data?.products ?? []} saved={menu.refresh} />
          {deleting && (
            <DeleteProductDialog
              product={deleting}
              close={() => setDeleting(null)}
              expired={expired}
              deleted={(alreadyRemoved) => {
                setMenuNotice(
                  alreadyRemoved
                    ? `«${deleting.name}» уже отсутствует в меню.`
                    : `«${deleting.name}» удалён из меню.`,
                );
                setDeleting(null);
                menu.refresh();
              }}
            />
          )}
          {editing ? (
            <ProductEditor
              key={editing.id}
              product={editing}
              expired={expired}
              done={() => {
                setEditing(null);
                menu.refresh();
              }}
            />
          ) : (
            <>
              <div className="section-top">
                <h2 id="kitchen-menu-heading" tabIndex={-1}>
                  Ваше меню
                </h2>
                {role !== 'worker' && (
                  <button
                    className="button small"
                    onClick={() =>
                      setEditing({
                        id: 0,
                        name: '',
                        description: '',
                        price: 290,
                        image: '/images/classic.jpg',
                        weight: '',
                        category: 'Шаверма',
                        available: true,
                        sort_order: (menu.data?.products.length ?? 0) + 1,
                        ingredients: '',
                        allergens: '',
                        options: [],
                      })
                    }
                  >
                    <Plus size={18} /> Добавить товар
                  </button>
                )}
              </div>
              {menuNotice && <Notice kind="success">{menuNotice}</Notice>}
              {menu.data?.products.length === 0 && <p className="muted">Меню пока пусто.</p>}
              <div className="staff-products">
                {menu.data?.products.map((p) => (
                  <div className="panel staff-product" key={p.id}>
                    <FoodImage src={p.image} alt={p.name} />
                    <div>
                      <h3>{p.name}</h3>
                      <b>{rub(p.price)}</b>
                      <button
                        className={
                          'availability-toggle ' +
                          (p.available ? 'available-label' : 'text-error')
                        }
                        type="button"
                        role="switch"
                        aria-checked={p.available}
                        aria-label={'В продаже: ' + p.name}
                        disabled={busy}
                        onClick={() => void toggleProduct(p)}
                      >
                        <span className="toggle-track">
                          <i />
                        </span>
                        {p.available ? 'В продаже' : 'Недоступен'}
                      </button>
                    </div>
                    {role !== 'worker' && !p.topping_id && (
                      <div className="staff-product-actions">
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => setEditing(p)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="button secondary small product-delete"
                          aria-label={'Удалить товар ' + p.name}
                          disabled={busy}
                          onClick={() => {
                            setMenuNotice('');
                            setDeleting(p);
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" /> Удалить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'settings' &&
        menu.data &&
        (role === 'worker' ? (
          <WorkerSettings settings={menu.data.settings} saved={menu.refresh} />
        ) : (
          <SettingsForm settings={menu.data.settings} saved={menu.refresh} expired={expired} />
        ))}
    </main>
  );
}
