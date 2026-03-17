import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ActiveVideoContextValue {
  /** URI of the post whose video should be autoplaying */
  activeVideoUri: string | null;
  /** Set the active video (called from viewability tracking) */
  setActiveVideo: (uri: string | null) => void;
}

const ActiveVideoContext = createContext<ActiveVideoContextValue>({
  activeVideoUri: null,
  setActiveVideo: () => {},
});

export function ActiveVideoProvider({ children }: { children: ReactNode }) {
  const [activeVideoUri, setActiveVideoUri] = useState<string | null>(null);

  const setActiveVideo = useCallback((uri: string | null) => {
    setActiveVideoUri(uri);
  }, []);

  return (
    <ActiveVideoContext.Provider value={{ activeVideoUri, setActiveVideo }}>
      {children}
    </ActiveVideoContext.Provider>
  );
}

export function useActiveVideo() {
  return useContext(ActiveVideoContext);
}
