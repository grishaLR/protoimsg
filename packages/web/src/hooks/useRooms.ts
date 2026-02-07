import { useCallback, useEffect, useState } from 'react';
import { fetchRooms } from '../lib/api';
import type { RoomView } from '../types';

export function useRooms() {
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRooms();
      setRooms(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rooms, loading, error, refresh };
}
