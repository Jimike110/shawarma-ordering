import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, MapPin } from 'lucide-react';
import { useMenu } from './menu';
import { rememberPickup, usePickupStores } from './pickupStores';

export function PickupSelector() {
  const { data: menu } = useMenu();
  const { data: stores, error } = usePickupStores();
  const navigate = useNavigate();
  const current = menu?.store;
  useEffect(() => {
    if (current?.slug) rememberPickup(current.slug);
  }, [current?.slug]);
  const choices = [...(stores ?? [])];
  // Pending checkout remains reachable even after its store is hidden.
  if (current && !choices.some((store) => store.id === current.id)) choices.unshift(current);
  return (
    <label className="pickup-selector">
      <MapPin size={19} aria-hidden="true" />
      <span className="pickup-selector-field">
        <select
          aria-label="Адрес самовывоза"
          value={current?.slug ?? ''}
          disabled={!stores}
          title={error || menu?.settings.address}
          onChange={(event) => {
            const next = choices.find((store) => store.slug === event.target.value);
            if (!next || next.id === current?.id) return;
            rememberPickup(next.slug);
            navigate('/s/' + next.slug);
          }}
        >
          {choices.map((store) => (
            <option key={store.id} value={store.slug}>
              {store.settings.address || store.settings.shop_name}
            </option>
          ))}
        </select>
      </span>
      <ChevronDown size={16} aria-hidden="true" />
    </label>
  );
}
