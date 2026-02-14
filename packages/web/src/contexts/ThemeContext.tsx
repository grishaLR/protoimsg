import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';

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

export const THEME_OPTIONS: { id: Theme; labelKey: string }[] = [
  { id: 'aim', labelKey: 'theme.aim' },
  { id: 'nyt-light', labelKey: 'theme.nytLight' },
  { id: 'nyt-dark', labelKey: 'theme.nytDark' },
  { id: 'dracula', labelKey: 'theme.dracula' },
  { id: 'valentine', labelKey: 'theme.valentine' },
  { id: 'garden', labelKey: 'theme.garden' },
  { id: 'coffee', labelKey: 'theme.coffee' },
  { id: 'fantasy', labelKey: 'theme.fantasy' },
  { id: 'nord', labelKey: 'theme.nord' },
  { id: 'retro', labelKey: 'theme.retro' },
  { id: 'black', labelKey: 'theme.black' },
  { id: 'wireframe', labelKey: 'theme.wireframe' },
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

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
