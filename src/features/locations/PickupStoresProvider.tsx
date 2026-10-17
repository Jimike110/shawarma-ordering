import { createContext, useCallback, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { type Store } from '@/shared/api/types';

const PickupStoresContext = createContext<ReturnType<typeof usePolling<Store[]>> | null>(null);

const selectedKey = 'shawarma-pickup-store';

export function PickupStoresProvider() {
  const load = useCallback((signal: AbortSignal) => api<Store[]>('/stores', { signal }), []);
  const value = usePolling(load, 15000);
  return (
    <PickupStoresContext.Provider value={value}>
      <Outlet />
    </PickupStoresContext.Provider>
  );
}

export function usePickupStores() {
  const value = useContext(PickupStoresContext);
  if (!value) throw new Error('PickupStoresProvider is missing');
  return value;
}

export function preferredPickup(stores: Store[]): Store | undefined {
  try {
    const slug = localStorage.getItem(selectedKey);
    const saved = stores.find((store) => store.slug === slug);
    if (saved) return saved;
  } catch {}
  return undefined;
}

export function hasRememberedPickup(): boolean {
  try {
    return !!localStorage.getItem(selectedKey);
  } catch {
    return false;
  }
}

export function rememberPickup(slug: string) {
  try {
    localStorage.setItem(selectedKey, slug);
  } catch {}
}
