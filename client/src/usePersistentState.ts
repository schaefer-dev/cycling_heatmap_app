import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'cycling-archive:';

/** useState that survives reloads (localStorage). Falls back silently when storage is unavailable. */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      // Merge objects so newly added settings get their defaults.
      return typeof initial === 'object' && initial !== null && !Array.isArray(initial)
        ? { ...initial, ...parsed }
        : parsed;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // storage full or disabled: the setting just won't persist
    }
  }, [key, value]);

  return [value, setValue];
}
