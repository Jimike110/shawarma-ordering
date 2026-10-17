import { useEffect, useRef, useState } from 'react';
import {
  map as createMap,
  tileLayer,
  marker,
  divIcon,
  latLngBounds,
  type Map as LeafletMap,
  type Marker,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type Store } from '@/shared/api/types';
import { storeCoordinates, type Coordinates } from '@/features/locations/pickupLocation';

export function PickupMap({
  stores,
  selected,
  choose,
  position,
  focusRevision = 0,
}: {
  stores: Store[];
  selected: number | null;
  choose: (id: number) => void;
  position: Coordinates | null;
  focusRevision?: number;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<number, { marker: Marker; button: HTMLButtonElement }>());
  const user = useRef<Marker | null>(null),
    callback = useRef(choose);
  callback.current = choose;
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false);
  const [touch, setTouch] = useState(false),
    [interactive, setInteractive] = useState(false);
  const fitted = useRef('');
  const locationKey = stores
    .map((s, i) =>
      [
        s.id,
        i,
        s.settings.latitude,
        s.settings.longitude,
        s.settings.address,
        s.accepting_orders,
      ].join(':'),
    )
    .join('|');
  useEffect(() => {
    const touchDevice = window.matchMedia('(pointer: coarse)').matches;
    setTouch(touchDevice);
    const instance = createMap(container.current!, {
      center: [59.9391, 30.3158],
      zoom: 10,
      zoomControl: true,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: !touchDevice,
      doubleClickZoom: !touchDevice,
      boxZoom: !touchDevice,
    });
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    const tiles = tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 3,
      maxZoom: 19,
      keepBuffer: 1,
      updateWhenIdle: true,
      // Send the site origin, never checkout paths/private links, as required by
      // OSM's tile policy. Browser caching remains enabled; no offline prefetch.
      referrerPolicy: 'strict-origin',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(instance);
    let loaded = false;
    tiles.on('tileerror', () => setFailed(true));
    tiles.on('load', () => {
      loaded = true;
    });
    setReady(true);
    const timeout = setTimeout(() => {
      if (!loaded) setFailed(true);
    }, 12000);
    const resize = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    resize.observe(container.current!);
    return () => {
      clearTimeout(timeout);
      resize.disconnect();
      markers.current.clear();
      user.current = null;
      fitted.current = '';
      map.current = null;
      instance.remove();
    };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !touch) return;
    // Leaflet owns this element's classes. React must not replace them when
    // switching gestures, or the tile container loses its rendering styles.
    instance.getContainer().classList.toggle('is-interactive', interactive);
    for (const handler of [instance.dragging, instance.touchZoom, instance.doubleClickZoom]) {
      if (interactive) handler.enable();
      else handler.disable();
    }
  }, [touch, interactive, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const value of markers.current.values()) value.marker.remove();
    markers.current.clear();
    const bounds = latLngBounds([]);
    stores.forEach((s, i) => {
      const coords = storeCoordinates(s.settings);
      if (!coords) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(i + 1);
      button.className = 'pickup-map-pin' + (s.accepting_orders ? '' : ' is-unavailable');
      button.setAttribute('aria-label', 'Выбрать точку на карте: ' + s.settings.address);
      button.title = s.settings.address;
      button.addEventListener('click', () => callback.current(s.id));
      const pin = marker([coords.latitude, coords.longitude], {
        keyboard: false,
        icon: divIcon({
          html: button,
          className: 'pickup-marker-shell',
          iconSize: [44, 44],
          iconAnchor: [22, 44],
        }),
      }).addTo(instance);
      markers.current.set(s.id, { marker: pin, button });
      bounds.extend([coords.latitude, coords.longitude]);
    });
    const geometry = stores
      .map((s) => [s.id, s.settings.latitude, s.settings.longitude].join(':'))
      .join('|');
    if (bounds.isValid() && geometry !== fitted.current) {
      instance.fitBounds(bounds, { padding: [55, 55], maxZoom: 15, animate: false });
      fitted.current = geometry;
    }
  }, [locationKey, ready]);
  useEffect(() => {
    for (const [id, { marker: pin, button }] of markers.current) {
      button.classList.toggle('is-selected', id === selected);
      button.setAttribute('aria-pressed', String(id === selected));
      pin.setZIndexOffset(id === selected ? 1000 : 0);
    }
    const current = stores.find((s) => s.id === selected),
      coords = current && storeCoordinates(current.settings);
    if (coords)
      map.current?.setView(
        [coords.latitude, coords.longitude],
        Math.max(map.current.getZoom(), 14),
        { animate: false },
      );
  }, [selected, locationKey, ready, focusRevision]);
  useEffect(() => {
    user.current?.remove();
    const instance = map.current;
    if (!instance || !position) return;
    const dot = document.createElement('div');
    dot.className = 'pickup-user-dot';
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'Ваше примерное местоположение');
    user.current = marker([position.latitude, position.longitude], {
      keyboard: false,
      icon: divIcon({
        html: dot,
        className: 'pickup-marker-shell',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(instance);
    return () => {
      user.current?.remove();
      user.current = null;
    };
  }, [position, ready]);
  return (
    <div className="pickup-map-wrapper">
      <div ref={container} className="pickup-map" aria-label="Карта точек самовывоза" />
      {touch && (
        <button
          type="button"
          className="pickup-map-touch-control"
          aria-pressed={interactive}
          onClick={() => setInteractive(!interactive)}
        >
          {interactive ? 'Готово' : 'Двигать карту'}
        </button>
      )}
      {failed && (
        <p className="pickup-map-error" role="status">
          Карта недоступна или загрузилась не полностью. Выберите адрес в списке.
        </p>
      )}
    </div>
  );
}
