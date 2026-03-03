import {
  themes,
  THEME_NAMES,
  THEME_LABELS,
  DARK_THEMES,
  isDarkTheme,
  type ThemeName,
  type ThemeColors,
} from '../../src/theme/themes';

// Every theme key that ThemeColors requires (derived from the interface definition)
const REQUIRED_KEYS: (keyof ThemeColors)[] = [
  'base100',
  'base200',
  'base300',
  'baseContent',
  'primary',
  'primaryContent',
  'secondary',
  'secondaryContent',
  'accent',
  'accentContent',
  'neutral',
  'neutralContent',
  'success',
  'warning',
  'error',
  'successContent',
  'warningContent',
  'errorContent',
  'statusIdle',
  'statusOffline',
  'surface',
  'surfaceContent',
  'surfaceButton',
  'buttonHover',
  'chromeText',
  'chromeTextMuted',
  'desktop',
  'primaryDark',
  'borderLight',
  'borderDark',
  'titlebar',
  'titlebarInactive',
  'selection',
  'errorBannerBg',
  'errorBannerText',
];

describe('themes', () => {
  it('should have entries for all THEME_NAMES', () => {
    for (const name of THEME_NAMES) {
      expect(themes[name]).toBeDefined();
    }
  });

  it('should have exactly 12 themes', () => {
    expect(THEME_NAMES).toHaveLength(12);
  });

  it.each(THEME_NAMES)('theme "%s" has all required color keys', (name: ThemeName) => {
    const theme = themes[name];
    for (const key of REQUIRED_KEYS) {
      expect(theme[key]).toBeDefined();
      expect(typeof theme[key]).toBe('string');
    }
  });

  it.each(THEME_NAMES)('theme "%s" has a label', (name: ThemeName) => {
    expect(THEME_LABELS[name]).toBeTruthy();
    expect(typeof THEME_LABELS[name]).toBe('string');
  });

  it('isDarkTheme returns true for dark themes', () => {
    for (const name of DARK_THEMES) {
      expect(isDarkTheme(name)).toBe(true);
    }
  });

  it('isDarkTheme returns false for light themes', () => {
    const lightThemes = THEME_NAMES.filter((n) => !DARK_THEMES.has(n));
    expect(lightThemes.length).toBeGreaterThan(0);
    for (const name of lightThemes) {
      expect(isDarkTheme(name)).toBe(false);
    }
  });

  it('all color values are valid CSS colors', () => {
    const colorRegex =
      /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\))$/;
    for (const name of THEME_NAMES) {
      const theme = themes[name];
      for (const key of REQUIRED_KEYS) {
        expect(theme[key]).toMatch(colorRegex);
      }
    }
  });
});
