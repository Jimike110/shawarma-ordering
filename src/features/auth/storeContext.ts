import { createContext, useContext } from 'react';
import { type api } from '@/shared/api/client';

export const StaffStoreContext = createContext<{
  id: number;
  role: string;
  request: typeof api;
} | null>(null);

export function useStaffStore() {
  const value = useContext(StaffStoreContext);
  if (!value) throw new Error('Missing assigned store');
  return value;
}
