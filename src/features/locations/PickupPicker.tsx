import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin,
  LocateFixed,
  Search,
  X,
  ArrowUpRight,
  Check,
  Navigation,
  Map,
} from 'lucide-react';
import { type Store } from '@/shared/api/types';
import {
  directionsURL,
  distanceLabel,
  distanceMetres,
  storeCoordinates,
  todayHours,
  type Coordinates,
} from '@/features/locations/pickupLocation';
import '@/features/locations/pickup.css';

const PickupMap = lazy(() =>
  import('@/features/locations/PickupMap').then((m) => ({ default: m.PickupMap })),
);

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="pickup-map-loading" role="status">
        Не удалось загрузить карту. Выберите адрес ниже.
      </p>
    ) : (
      this.props.children
    );
  }
}

export function PickupPicker({
  stores,
  current,
  onChoose,
  close,
  error = '',
  refresh,
}: {
  stores: Store[];
  current?: Store;
  onChoose: (store: Store) => void;
  close?: () => void;
  error?: string;
  refresh: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(current?.id ?? null);
  const [query, setQuery] = useState('');
  const [showMap, setShowMap] = useState(true);
  const [mapReveal, setMapReveal] = useState(0);
  const mapColumn = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false),
    [locationError, setLocationError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const alive = useRef(true);
  const searchId = useId();
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const choices = useMemo(
    () =>
      stores
        .filter((s) => s.published && !s.archived)
        .filter((s) =>
          [
            s.settings.address,
            s.settings.city,
            s.settings.landmark,
            s.settings.entrance,
            s.settings.shop_name,
          ]
            .join(' ')
            .toLocaleLowerCase('ru')
            .includes(query.trim().toLocaleLowerCase('ru')),
        )
        .map((store) => {
          const coords = storeCoordinates(store.settings);
          return {
            store,
            distance: position && coords ? distanceMetres(position, coords) : null,
          };
        })
        .sort((a, b) => (position ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : 0)),
    [stores, query, position],
  );
  const active = choices.find(({ store }) => store.id === selected)?.store;
  useEffect(() => {
    if (!mapReveal) return;
    mapColumn.current?.scrollIntoView?.({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [mapReveal]);
  function locate() {
    if (locating) return;
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Геопозиция недоступна. Выберите адрес вручную.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!alive.current) return;
        setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setLocating(false);
      },
      (e) => {
        if (!alive.current) return;
        setLocating(false);
        setLocationError(
          e.code === 1
            ? 'Доступ к геопозиции не разрешён. Выберите адрес вручную.'
            : 'Не удалось определить место. Выберите адрес или попробуйте ещё раз.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  function pick(id: number) {
    setSelected(id);
  }
  function preview(store: Store) {
    setSelected(store.id);
    if (storeCoordinates(store.settings)) setShowMap(true);
    setMapReveal((value) => value + 1);
  }
  return (
    <section
      className={'pickup-picker' + (showMap || active ? ' pickup-with-map' : '')}
      aria-label="Выбор точки самовывоза"
    >
      <header className="pickup-picker-header">
        <div>
          <h1>Где заберёте заказ?</h1>
          <p>Выберите точку и перейдите к её меню.</p>
        </div>
        {close ? (
          <button
            type="button"
            className="icon-button pickup-close"
            aria-label="Закрыть выбор точки"
            onClick={close}
          >
            <X />
          </button>
        ) : (
          <Link className="pickup-orders-link" to="/orders">
            Мои заказы <ArrowUpRight size={16} />
          </Link>
        )}
      </header>
      <div className="pickup-tools">
        <label className="pickup-search" htmlFor={searchId}>
          <Search size={18} />
          <span className="sr-only">Улица, метро или ориентир</span>
          <input
            id={searchId}
            type="search"
            placeholder="Адрес или метро"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="pickup-tool-button"
          onClick={locate}
          disabled={locating}
        >
          <LocateFixed size={18} />
          {locating ? 'Определяем…' : 'Рядом со мной'}
        </button>
        <button
          type="button"
          className="pickup-tool-button"
          aria-pressed={showMap}
          onClick={() => setShowMap(!showMap)}
        >
          <Map size={18} />
          {showMap ? 'Скрыть карту' : 'Показать карту'}
        </button>
      </div>
      {(error || locationError) && (
        <div className="pickup-message" role="status">
          {error
            ? 'Не удалось обновить точки. Показаны последние данные. ' + error
            : locationError}{' '}
          <button type="button" className="text-link" onClick={error ? refresh : locate}>
            Повторить
          </button>
        </div>
      )}
      {current && !stores.some((s) => s.id === current.id) && (
        <p className="pickup-message">
          Текущая точка больше не опубликована. Выберите другой адрес; уже отправленный заказ
          остаётся в прежней точке.
        </p>
      )}
      <div className="pickup-body">
        {(showMap || active) && (
          <div className="pickup-map-column" ref={mapColumn}>
            {showMap && (
              <div className="pickup-map-pane">
                <MapBoundary>
                  <Suspense
                    fallback={
                      <div className="pickup-map-loading" role="status">
                        Загружаем карту…
                      </div>
                    }
                  >
                    <PickupMap
                      stores={choices.map((c) => c.store)}
                      selected={selected}
                      focusRevision={mapReveal}
                      choose={pick}
                      position={position}
                    />
                  </Suspense>
                </MapBoundary>
                {choices.some(({ store }) => !storeCoordinates(store.settings)) && (
                  <p className="pickup-map-note">
                    Не все точки отмечены на карте. Выберите адрес из списка.
                  </p>
                )}
              </div>
            )}
            {active && (
              <div className="pickup-map-selection">
                <strong>{active.settings.address || active.settings.shop_name}</strong>
                {!storeCoordinates(active.settings) && (
                  <span>Метка на карте пока не указана.</span>
                )}
                <button type="button" className="button" onClick={() => onChoose(active)}>
                  Перейти к меню
                </button>
              </div>
            )}
          </div>
        )}
        <div className="pickup-store-list" aria-label="Адреса точек">
          {position && choices.length > 0 && (
            <p className="pickup-sort-label">Сначала ближайшие · расстояние по прямой</p>
          )}
          {choices.map(({ store: s, distance }, index) => (
            <article
              key={s.id}
              className={'pickup-store-card' + (selected === s.id ? ' is-selected' : '')}
            >
              <button
                type="button"
                className="pickup-store-choose"
                aria-label={'Выбрать точку: ' + s.settings.address}
                aria-current={current?.id === s.id ? 'location' : undefined}
                aria-pressed={selected === s.id}
                onClick={() => preview(s)}
              >
                <span className="pickup-pin-number">{index + 1}</span>
                <span className="pickup-card-content">
                  <strong>{s.settings.address || s.settings.shop_name}</strong>
                  <span className="pickup-card-city">
                    {s.settings.city}
                    {s.settings.landmark ? ' · ' + s.settings.landmark : ''}
                  </span>
                  <span
                    className={
                      'pickup-intake ' +
                      (s.accepting_orders ? 'is-accepting' : 'is-unavailable')
                    }
                  >
                    {s.accepting_orders
                      ? 'Принимаем заказы'
                      : s.intake_message || 'Не принимаем заказы'}
                  </span>
                  {distance !== null && (
                    <span className="pickup-card-distance">{distanceLabel(distance)}</span>
                  )}
                  <span className="pickup-card-action">
                    {selected === s.id ? 'Выбрана' : 'Показать на карте'}
                    {current?.id === s.id ? ' · Текущая точка' : ''}
                  </span>
                </span>
                {selected === s.id ? <Check size={20} /> : <MapPin size={20} />}
              </button>
              <details className="pickup-store-details">
                <summary>О точке и маршрут</summary>
                <div>
                  <p>{todayHours(s.settings, now)}</p>
                  {s.settings.entrance && <p>{s.settings.entrance}</p>}
                  {directionsURL(s) && (
                    <a href={directionsURL(s)!} target="_blank" rel="noopener noreferrer">
                      <Navigation size={16} />
                      Маршрут в Яндекс Картах
                    </a>
                  )}
                </div>
              </details>
            </article>
          ))}
          {choices.length === 0 && (
            <div className="pickup-empty">
              <MapPin size={28} />
              <h2>{stores.length ? 'Точки не найдены' : 'Пока нет доступных точек'}</h2>
              <p>
                {stores.length
                  ? 'Попробуйте другой адрес или название метро.'
                  : 'Загляните позже. Здесь появятся опубликованные адреса.'}
              </p>
              {query && (
                <button type="button" className="button secondary" onClick={() => setQuery('')}>
                  Сбросить поиск
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="pickup-privacy">
        Геопозиция не сохраняется в нашем сервисе. Карта —{' '}
        <a
          href="https://osmfoundation.org/wiki/Privacy_Policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenStreetMap
        </a>
        .
      </p>
    </section>
  );
}
