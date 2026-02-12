import { useCallback, useEffect, useState } from 'react';
import { fetchRooms } from '../lib/api';
import type { RoomView } from '../types';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRooms({ signal });
      setRooms(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load rooms');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => {
      ac.abort();
    };
  }, [refresh]);

  return { rooms, loading, error, refresh };
}
