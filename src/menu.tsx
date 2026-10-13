import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { api } from './api';
import { usePolling } from './usePolling';
import type { Menu } from './types';

const MenuContext = createContext<ReturnType<typeof usePolling<Menu>> | null>(null);
export function FrozenMenuProvider({ children, menu }: { children: ReactNode; menu: Menu }) {
  const current = useMenu();
  return <MenuContext.Provider value={{ ...current, data: menu }}>{children}</MenuContext.Provider>;
}
export function MenuProvider({
  children,
  endpoint = '/menu',
}: {
  children: ReactNode;
  endpoint?: string;
}) {
  const load = useCallback((signal: AbortSignal) => api<Menu>(endpoint, { signal }), [endpoint]);
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
