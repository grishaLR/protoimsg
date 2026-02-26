/**
 * Theme color definitions — mirrors the web CSS custom properties.
 * Dracula (dark) and Garden (light) themes from packages/ui/src/tokens/.
 */

export interface ThemeColors {
  // Surface
  base100: string;
  base200: string;
  base300: string;
  baseContent: string;

  // Primary
  primary: string;
  primaryContent: string;

  // Secondary
  secondary: string;
  secondaryContent: string;

  // Accent
  accent: string;
  accentContent: string;

  // Neutral
  neutral: string;
  neutralContent: string;

  // Status
  success: string;
  warning: string;
  error: string;
  successContent: string;
  warningContent: string;
  errorContent: string;

  // Presence status
  statusIdle: string;
  statusOffline: string;

  // Surface & chrome
  surface: string;
  surfaceContent: string;
  surfaceButton: string;
  buttonHover: string;
  chromeText: string;
  chromeTextMuted: string;
  desktop: string;
  primaryDark: string;

  // Borders
  borderLight: string;
  borderDark: string;

  // Titlebar
  titlebar: string;
  titlebarInactive: string;

  // Selection
  selection: string;

  // Error banner
  errorBannerBg: string;
  errorBannerText: string;
}

export type ThemeName = 'dracula' | 'garden';

export const themes: Record<ThemeName, ThemeColors> = {
  dracula: {
    base100: '#232530',
    base200: '#343746',
    base300: '#414558',
    baseContent: '#f8f8f2',

    primary: '#ff79c6',
    primaryContent: '#160015',

    secondary: '#bd93f9',
    secondaryContent: '#0d0815',

    accent: '#ffb86c',
    accentContent: '#160c04',

    neutral: '#555168',
    neutralContent: '#d8d6de',

    success: '#50fa7b',
    warning: '#f1fa8c',
    error: '#ff5555',
    successContent: '#021505',
    warningContent: '#141507',
    errorContent: '#1f0a0a',

    statusIdle: '#6272a4',
    statusOffline: '#44475a',

    surface: '#1f202a',
    surfaceContent: '#282a36',
    surfaceButton: '#343746',
    buttonHover: '#414558',
    chromeText: '#f8f8f2',
    chromeTextMuted: '#b0b4c8',
    desktop: '#1f202a',
    primaryDark: '#bd93f9',

    borderLight: 'rgba(189, 147, 249, 0.12)',
    borderDark: '#b0b4c8',

    titlebar: '#282a36',
    titlebarInactive: '#1f202a',

    selection: '#44475a',

    errorBannerBg: '#3b0a0a',
    errorBannerText: '#fca5a5',
  },

  garden: {
    base100: '#e9e7e7',
    base200: '#d4d2d2',
    base300: '#bfbdbd',
    baseContent: '#100f0f',

    primary: '#fe0075',
    primaryContent: '#ffffff',

    secondary: '#8e4162',
    secondaryContent: '#ead7de',

    accent: '#5c7f67',
    accentContent: '#ffffff',

    neutral: '#291e00',
    neutralContent: '#e9e7e7',

    success: '#00a96e',
    warning: '#ffbe00',
    error: '#ff5861',
    successContent: '#000000',
    warningContent: '#000000',
    errorContent: '#000000',

    statusIdle: '#a8a5a5',
    statusOffline: '#bfbdbd',

    surface: '#e9e7e7',
    surfaceContent: '#f5f3f3',
    surfaceButton: '#d4d2d2',
    buttonHover: '#c8c5c5',
    chromeText: '#100f0f',
    chromeTextMuted: '#706a6a',
    desktop: '#e9e7e7',
    primaryDark: '#d60063',

    borderLight: 'rgba(41, 30, 0, 0.08)',
    borderDark: '#706a6a',

    titlebar: '#d4d2d2',
    titlebarInactive: '#bfbdbd',

    selection: '#f5c6d8',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#991b1b',
  },
};
