import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type Theme =
  | 'aim'
  | 'nyt-light'
  | 'nyt-dark'
  | 'dracula'
  | 'valentine'
  | 'garden'
  | 'coffee'
  | 'fantasy'
  | 'nord'
  | 'retro'
  | 'black'
  | 'wireframe';

export const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'aim', label: 'AIM Classic' },
  { id: 'nyt-light', label: 'Minimal Light' },
  { id: 'nyt-dark', label: 'Minimal Dark' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'valentine', label: 'Valentine' },
  { id: 'garden', label: 'Garden' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'nord', label: 'Nord' },
  { id: 'retro', label: 'Retro' },
  { id: 'black', label: 'Black' },
  { id: 'wireframe', label: 'Wireframe' },
];

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((t) => t.id));

const STORAGE_KEY = 'protoimsg:theme';
const DEFAULT_THEME: Theme = 'aim';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_THEMES.has(stored)) return stored as Theme;
    return DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
