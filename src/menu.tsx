import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { api } from './api';
import { usePolling } from './usePolling';
import type { Menu } from './types';

const MenuContext = createContext<ReturnType<typeof usePolling<Menu>> | null>(null);
export function MenuProvider({ children }: { children: ReactNode }) {
  const load = useCallback((signal: AbortSignal) => api<Menu>('/menu', { signal }), []);
  const value = usePolling(load, 15000);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}
export function useMenu() {
  const value = useContext(MenuContext);
  if (!value) throw new Error('MenuProvider is missing');
  return value;
}
