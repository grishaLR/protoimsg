/**
 * AIM / Windows 98 bevel constants and helper hook.
 *
 * The classic Windows 98 look uses 4-layer inset box-shadows for raised/sunken
 * effects. React Native can't do inset shadows, but we simulate them with
 * two nested Views using per-side border colors.
 */

import { useTheme } from './ThemeContext';

/** Per-side border colors for the outer and inner layers of a bevel. */
export interface BevelLayer {
  top: string;
  left: string;
  bottom: string;
  right: string;
}

export interface BevelColors {
  outer: BevelLayer;
  inner: BevelLayer;
}

export const AIM_BEVEL = {
  raised: {
    outer: { top: '#fff', left: '#fff', bottom: '#0a0a0a', right: '#0a0a0a' },
    inner: { top: '#dfdfdf', left: '#dfdfdf', bottom: '#808080', right: '#808080' },
  },
  sunken: {
    outer: { top: '#808080', left: '#808080', bottom: '#fff', right: '#fff' },
    inner: { top: '#0a0a0a', left: '#0a0a0a', bottom: '#dfdfdf', right: '#dfdfdf' },
  },
  pressed: {
    outer: { top: '#0a0a0a', left: '#0a0a0a', bottom: '#fff', right: '#fff' },
    inner: { top: '#808080', left: '#808080', bottom: '#dfdfdf', right: '#dfdfdf' },
  },
} as const satisfies Record<string, BevelColors>;

export type BevelVariant = keyof typeof AIM_BEVEL;

/** Titlebar gradient (navy → light blue). */
export const AIM_TITLEBAR_GRADIENT = ['#08216b', '#a5c6ef'] as const;

/** Classic teal desktop background. */
export const AIM_DESKTOP = '#008080';

/** Drop shadow for the window frame (iOS only). */
export const AIM_WINDOW_SHADOW = {
  shadowColor: '#424242',
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 0.6,
  shadowRadius: 0,
} as const;

/** Hook that returns whether the current theme is AIM + AIM-specific radius. */
export function useAimStyle() {
  const { theme } = useTheme();
  const isAim = theme === 'aim';
  return {
    isAim,
    /** Use 0 for sharp corners in AIM, undefined to keep default. */
    aimRadius: isAim ? (0 as const) : undefined,
  };
}
