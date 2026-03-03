/**
 * Theme color definitions — mirrors the web CSS custom properties.
 * All 12 themes ported from packages/ui/src/tokens/theme-*.css.
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

export type ThemeName =
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

export const DARK_THEMES: ReadonlySet<ThemeName> = new Set([
  'dracula',
  'nyt-dark',
  'coffee',
  'black',
]);

export function isDarkTheme(name: ThemeName): boolean {
  return DARK_THEMES.has(name);
}

export const THEME_LABELS: Record<ThemeName, string> = {
  aim: 'AIM',
  'nyt-light': 'NYT Light',
  'nyt-dark': 'NYT Dark',
  dracula: 'Dracula',
  valentine: 'Valentine',
  garden: 'Garden',
  coffee: 'Coffee',
  fantasy: 'Fantasy',
  nord: 'Nord',
  retro: 'Retro',
  black: 'Black',
  wireframe: 'Wireframe',
};

/** Maps ThemeName to the i18n key suffix in common:theme.* */
export const THEME_I18N_KEYS: Record<ThemeName, string> = {
  aim: 'aim',
  'nyt-light': 'nytLight',
  'nyt-dark': 'nytDark',
  dracula: 'dracula',
  valentine: 'valentine',
  garden: 'garden',
  coffee: 'coffee',
  fantasy: 'fantasy',
  nord: 'nord',
  retro: 'retro',
  black: 'black',
  wireframe: 'wireframe',
};

export const THEME_NAMES: ThemeName[] = [
  'aim',
  'nyt-light',
  'nyt-dark',
  'dracula',
  'valentine',
  'garden',
  'coffee',
  'fantasy',
  'nord',
  'retro',
  'black',
  'wireframe',
];

export const themes: Record<ThemeName, ThemeColors> = {
  aim: {
    base100: '#d6d6ce',
    base200: '#c0c0c0',
    base300: '#a0a0a0',
    baseContent: '#0c0c0c',

    primary: '#0066cc',
    primaryContent: '#ffffff',

    secondary: '#f59e0b',
    secondaryContent: '#0c0c0c',

    accent: '#08216b',
    accentContent: '#ffffff',

    neutral: '#333333',
    neutralContent: '#d6d6ce',

    success: '#22c55e',
    warning: '#f59e0b',
    error: '#cc0000',
    successContent: '#ffffff',
    warningContent: '#0c0c0c',
    errorContent: '#ffffff',

    statusIdle: '#9ca3af',
    statusOffline: '#d1d5db',

    surface: '#d6d6ce',
    surfaceContent: '#ffffff',
    surfaceButton: '#c0c0c0',
    buttonHover: '#dfdfdf',
    chromeText: '#ffffff',
    chromeTextMuted: '#848484',
    desktop: '#008080',
    primaryDark: '#004499',

    borderLight: '#f4f4f4',
    borderDark: '#848484',

    titlebar: '#08216b',
    titlebarInactive: '#808080',

    selection: '#0000a2',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#991b1b',
  },

  'nyt-light': {
    base100: '#f5f5f7',
    base200: '#f0f0f3',
    base300: '#d2d2d7',
    baseContent: '#1d1d1f',

    primary: '#3b82f6',
    primaryContent: '#ffffff',

    secondary: '#f0ad4e',
    secondaryContent: '#1d1d1f',

    accent: '#3b82f6',
    accentContent: '#ffffff',

    neutral: '#444444',
    neutralContent: '#f5f5f7',

    success: '#28a745',
    warning: '#f0ad4e',
    error: '#cc3333',
    successContent: '#ffffff',
    warningContent: '#1d1d1f',
    errorContent: '#ffffff',

    statusIdle: '#9ca3af',
    statusOffline: '#c8c8c4',

    surface: '#f5f5f7',
    surfaceContent: '#ffffff',
    surfaceButton: '#ffffff',
    buttonHover: '#f0f0f3',
    chromeText: '#1d1d1f',
    chromeTextMuted: '#6e6e73',
    desktop: '#f5f5f7',
    primaryDark: '#2563eb',

    borderLight: '#e8e8ed',
    borderDark: '#6e6e73',

    titlebar: '#f0f0f3',
    titlebarInactive: '#d2d2d7',

    selection: '#bfdbfe',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#991b1b',
  },

  'nyt-dark': {
    base100: '#222234',
    base200: '#343448',
    base300: '#40405a',
    baseContent: '#f0f0f6',

    primary: '#8b9cf7',
    primaryContent: '#0f1020',

    secondary: '#f0ad4e',
    secondaryContent: '#0f1020',

    accent: '#8b9cf7',
    accentContent: '#0f1020',

    neutral: '#a8a8bc',
    neutralContent: '#1a1a28',

    success: '#4ade80',
    warning: '#f0ad4e',
    error: '#f87171',
    successContent: '#0f1020',
    warningContent: '#0f1020',
    errorContent: '#ffffff',

    statusIdle: '#7a7a90',
    statusOffline: '#505068',

    surface: '#1a1a28',
    surfaceContent: '#2c2c40',
    surfaceButton: '#343448',
    buttonHover: '#40405a',
    chromeText: '#f0f0f6',
    chromeTextMuted: '#b8b8d0',
    desktop: '#1a1a28',
    primaryDark: '#6b7de0',

    borderLight: 'rgba(160, 160, 220, 0.1)',
    borderDark: '#b8b8d0',

    titlebar: '#343448',
    titlebarInactive: '#222234',

    selection: '#2e3460',

    errorBannerBg: '#3b0a0a',
    errorBannerText: '#fca5a5',
  },

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

  valentine: {
    base100: '#fae9f3',
    base200: '#efd2e4',
    base300: '#ddadcc',
    baseContent: '#c41654',

    primary: '#e52b76',
    primaryContent: '#ffffff',

    secondary: '#9545d4',
    secondaryContent: '#f5e8f7',

    accent: '#7cc4dd',
    accentContent: '#2d5f78',

    neutral: '#7a1d40',
    neutralContent: '#ddadcc',

    success: '#5ec8a0',
    warning: '#d09030',
    error: '#e03545',
    successContent: '#1e4a38',
    warningContent: '#3d2a10',
    errorContent: '#fae9f3',

    statusIdle: '#c4a0b8',
    statusOffline: '#d0b8c6',

    surface: '#fae9f3',
    surfaceContent: '#ffffff',
    surfaceButton: '#efd2e4',
    buttonHover: '#ddadcc',
    chromeText: '#c41654',
    chromeTextMuted: '#a85578',
    desktop: '#fae9f3',
    primaryDark: '#c41654',

    borderLight: 'rgba(122, 29, 64, 0.08)',
    borderDark: '#a85578',

    titlebar: '#efd2e4',
    titlebarInactive: '#ddadcc',

    selection: '#f0c0d8',

    errorBannerBg: '#fde0e8',
    errorBannerText: '#991b1b',
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

  coffee: {
    base100: '#1c131b',
    base200: '#2a1f29',
    base300: '#382d37',
    baseContent: '#c59f60',

    primary: '#db924b',
    primaryContent: '#110802',

    secondary: '#263e3f',
    secondaryContent: '#d0d5d5',

    accent: '#10576d',
    accentContent: '#cfdce1',

    neutral: '#120c12',
    neutralContent: '#c9c7c9',

    success: '#9db787',
    warning: '#ffd25f',
    error: '#fc9581',
    successContent: '#090c06',
    warningContent: '#161003',
    errorContent: '#160806',

    statusIdle: '#7a6a58',
    statusOffline: '#4a3a42',

    surface: '#181017',
    surfaceContent: '#20161f',
    surfaceButton: '#2a1f29',
    buttonHover: '#382d37',
    chromeText: '#d4b896',
    chromeTextMuted: '#a08a6a',
    desktop: '#181017',
    primaryDark: '#c47e38',

    borderLight: 'rgba(197, 159, 96, 0.1)',
    borderDark: '#a08a6a',

    titlebar: '#2a1f29',
    titlebarInactive: '#1c131b',

    selection: '#3a2a1e',

    errorBannerBg: '#3b0a0a',
    errorBannerText: '#fca5a5',
  },

  fantasy: {
    base100: '#ffffff',
    base200: '#ebebeb',
    base300: '#d5d5d5',
    baseContent: '#2b3440',

    primary: '#6e0b75',
    primaryContent: '#e0c8e5',

    secondary: '#1a5fb4',
    secondaryContent: '#daeaf8',

    accent: '#e4a020',
    accentContent: '#1c1408',

    neutral: '#2b3440',
    neutralContent: '#d5d6db',

    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    successContent: '#000000',
    warningContent: '#000000',
    errorContent: '#ffffff',

    statusIdle: '#a8a8b0',
    statusOffline: '#c8c8cc',

    surface: '#f5f5f5',
    surfaceContent: '#ffffff',
    surfaceButton: '#ebebeb',
    buttonHover: '#dfdfdf',
    chromeText: '#2b3440',
    chromeTextMuted: '#6b6b78',
    desktop: '#f5f5f5',
    primaryDark: '#5a0860',

    borderLight: 'rgba(43, 52, 64, 0.08)',
    borderDark: '#6b6b78',

    titlebar: '#ebebeb',
    titlebarInactive: '#d5d5d5',

    selection: '#e0d0f0',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#991b1b',
  },

  nord: {
    base100: '#eceff4',
    base200: '#e5e9f0',
    base300: '#d8dee9',
    baseContent: '#3b4252',

    primary: '#5e81ac',
    primaryContent: '#eceff4',

    secondary: '#81a1c1',
    secondaryContent: '#eceff4',

    accent: '#8fbcbb',
    accentContent: '#2e3440',

    neutral: '#4c566a',
    neutralContent: '#d8dee9',

    success: '#a3be8c',
    warning: '#ebcb8b',
    error: '#bf616a',
    successContent: '#2e3440',
    warningContent: '#2e3440',
    errorContent: '#eceff4',

    statusIdle: '#9ba4b4',
    statusOffline: '#b8bfcc',

    surface: '#eceff4',
    surfaceContent: '#f8f9fc',
    surfaceButton: '#e5e9f0',
    buttonHover: '#d8dee9',
    chromeText: '#3b4252',
    chromeTextMuted: '#7b8394',
    desktop: '#eceff4',
    primaryDark: '#4c6d91',

    borderLight: 'rgba(76, 86, 106, 0.1)',
    borderDark: '#7b8394',

    titlebar: '#e5e9f0',
    titlebarInactive: '#d8dee9',

    selection: '#b8cade',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#991b1b',
  },

  retro: {
    base100: '#ece3cd',
    base200: '#e0d4b4',
    base300: '#d0c098',
    baseContent: '#7a4822',

    primary: '#eca8a0',
    primaryContent: '#7d2818',

    secondary: '#c0ecc8',
    secondaryContent: '#286540',

    accent: '#b58424',
    accentContent: '#7a4822',

    neutral: '#696460',
    neutralContent: '#d4cec6',

    success: '#2a7068',
    warning: '#d45020',
    error: '#e85540',
    successContent: '#f0e4c8',
    warningContent: '#f0e4c8',
    errorContent: '#7a3020',

    statusIdle: '#b8aa90',
    statusOffline: '#c8bca4',

    surface: '#ece3cd',
    surfaceContent: '#f5efe0',
    surfaceButton: '#e0d4b4',
    buttonHover: '#d4c8a8',
    chromeText: '#7a4822',
    chromeTextMuted: '#8a7460',
    desktop: '#ece3cd',
    primaryDark: '#c88880',

    borderLight: 'rgba(122, 72, 34, 0.1)',
    borderDark: '#8a7460',

    titlebar: '#e0d4b4',
    titlebarInactive: '#d0c098',

    selection: '#e8cca0',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#7a3020',
  },

  black: {
    base100: '#000000',
    base200: '#171717',
    base300: '#2a2a2a',
    baseContent: '#d4d4d4',

    primary: '#787878',
    primaryContent: '#ffffff',

    secondary: '#787878',
    secondaryContent: '#ffffff',

    accent: '#787878',
    accentContent: '#ffffff',

    neutral: '#787878',
    neutralContent: '#ffffff',

    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    successContent: '#000000',
    warningContent: '#000000',
    errorContent: '#000000',

    statusIdle: '#787878',
    statusOffline: '#525252',

    surface: '#000000',
    surfaceContent: '#0a0a0a',
    surfaceButton: '#1a1a1a',
    buttonHover: '#2a2a2a',
    chromeText: '#d4d4d4',
    chromeTextMuted: '#737373',
    desktop: '#000000',
    primaryDark: '#5a5a5a',

    borderLight: 'rgba(255, 255, 255, 0.08)',
    borderDark: '#737373',

    titlebar: '#171717',
    titlebarInactive: '#000000',

    selection: '#2a2a2a',

    errorBannerBg: '#1a0000',
    errorBannerText: '#ef4444',
  },

  wireframe: {
    base100: '#ffffff',
    base200: '#f5f5f5',
    base300: '#e8e8e8',
    baseContent: '#2b2b2b',

    primary: '#d4d4d4',
    primaryContent: '#3a3a3a',

    secondary: '#d4d4d4',
    secondaryContent: '#3a3a3a',

    accent: '#d4d4d4',
    accentContent: '#3a3a3a',

    neutral: '#d4d4d4',
    neutralContent: '#3a3a3a',

    success: '#196b55',
    warning: '#8c5a1e',
    error: '#901e24',
    successContent: '#b8e8d4',
    warningContent: '#e4dfa0',
    errorContent: '#e8c0b4',

    statusIdle: '#c0c0c0',
    statusOffline: '#d8d8d8',

    surface: '#ffffff',
    surfaceContent: '#fafafa',
    surfaceButton: '#e8e8e8',
    buttonHover: '#dcdcdc',
    chromeText: '#2b2b2b',
    chromeTextMuted: '#707070',
    desktop: '#f5f5f5',
    primaryDark: '#b8b8b8',

    borderLight: 'rgba(0, 0, 0, 0.12)',
    borderDark: '#707070',

    titlebar: '#f5f5f5',
    titlebarInactive: '#e8e8e8',

    selection: '#d8d8d8',

    errorBannerBg: '#fde8e8',
    errorBannerText: '#901e24',
  },
};
