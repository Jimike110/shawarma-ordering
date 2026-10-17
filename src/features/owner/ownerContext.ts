import { createContext, useContext, useEffect, useRef } from 'react';
import { type Store } from '@/shared/api/types';

export type Workspace = {
  stores: Store[] | null;
  selected: string;
  visible: Store[];
  refresh: () => void;
  href: (path: string, extra?: Record<string, string>) => string;
  selectStore: (id: string, saved?: boolean) => void;
  setDirty: (key: symbol, dirty: boolean) => void;
};

export const OwnerContext = createContext<Workspace | null>(null);

export function useOwnerWorkspace() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error('Missing owner workspace');
  return value;
}

export function useOwnerDraft(dirty: boolean) {
  const { setDirty } = useOwnerWorkspace();
  const key = useRef(Symbol());
  useEffect(() => {
    setDirty(key.current, dirty);
    return () => setDirty(key.current, false);
  }, [dirty, setDirty]);
}
