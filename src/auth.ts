import { createContext, useContext } from 'react';
import type { StaffAccount } from './types';

export interface AuthValue {
  user: StaffAccount | null;
  loading: boolean;
  error: string;
  setUser: (user: StaffAccount | null) => void;
  reload: () => Promise<void>;
  invalidate: () => void;
  logout: () => Promise<void>;
}

// Keep context identity outside component modules that Fast Refresh replaces.
export const AuthContext = createContext<AuthValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Missing staff authentication');
  return value;
}
