import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { storage } from '@/services/storage';
import { themes, type ThemeColors, type ThemeName } from './themes';

const THEME_KEY = 'protoimsg:theme';

function getStoredTheme(): ThemeName {
  const stored = storage.getString(THEME_KEY);
  if (stored === 'dracula' || stored === 'garden') return stored;
  return 'dracula';
}

interface ThemeContextValue {
  theme: ThemeName;
  colors: ThemeColors;
  toggle: () => void;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(getStoredTheme);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeState(name);
    storage.set(THEME_KEY, name);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dracula' ? 'garden' : 'dracula');
  }, [theme, setTheme]);

  const colors = themes[theme];

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, colors, toggle, setTheme }),
    [theme, colors, toggle, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
