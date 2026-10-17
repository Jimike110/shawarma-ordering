import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { type Menu } from '@/shared/api/types';

const MenuContext = createContext<ReturnType<typeof usePolling<Menu>> | null>(null);

export function FrozenMenuProvider({ children, menu }: { children: ReactNode; menu: Menu }) {
  const current = useMenu();
  return (
    <MenuContext.Provider value={{ ...current, data: menu }}>{children}</MenuContext.Provider>
  );
}

export function MenuProvider({
  children,
  endpoint = '/menu',
}: {
  children: ReactNode;
  endpoint?: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) => api<Menu>(endpoint, { signal }),
    [endpoint],
  );
  const value = usePolling(load, 15000);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useShopPath() {
  const { data } = useMenu();
  return data?.store ? '/s/' + data.store.slug : '';
}

export function useMenu() {
  const value = useContext(MenuContext);
  if (!value) throw new Error('MenuProvider is missing');
  return value;
}
