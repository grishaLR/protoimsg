import { createContext, useState, useCallback, useMemo, useContext, type ReactNode } from 'react';

const MUTED_KEY = 'protoimsg:video-muted';
const VOLUME_KEY = 'protoimsg:video-volume';

interface VideoVolumeContextValue {
  muted: boolean;
  volume: number;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

const VideoVolumeContext = createContext<VideoVolumeContextValue | null>(null);

export function VideoVolumeProvider({ children }: { children: ReactNode }) {
  const [muted, setMutedState] = useState<boolean>(() => {
    const stored = localStorage.getItem(MUTED_KEY);
    if (stored === 'false') return false;
    return true; // default muted
  });

  const [volume, setVolumeState] = useState<number>(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    }
    return 1;
  });

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    localStorage.setItem(MUTED_KEY, String(next));
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    setVolumeState(clamped);
    localStorage.setItem(VOLUME_KEY, String(clamped));
  }, []);

  const value = useMemo<VideoVolumeContextValue>(
    () => ({ muted, volume, setMuted, setVolume }),
    [muted, volume, setMuted, setVolume],
  );

  return <VideoVolumeContext.Provider value={value}>{children}</VideoVolumeContext.Provider>;
}

export function useVideoVolume(): VideoVolumeContextValue {
  const ctx = useContext(VideoVolumeContext);
  if (!ctx) throw new Error('useVideoVolume must be used within VideoVolumeProvider');
  return ctx;
}
