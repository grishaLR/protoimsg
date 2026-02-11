import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from '../contexts/ThemeContext';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
