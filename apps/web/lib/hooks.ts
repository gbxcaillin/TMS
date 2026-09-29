'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Minimal data hook: loads on mount / when the path changes, exposes reload + local mutate. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (n === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (n === seq.current) setError(err as Error);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, mutate: setData };
}
