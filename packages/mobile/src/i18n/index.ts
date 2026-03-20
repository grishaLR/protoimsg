import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Alert, I18nManager, Platform, NativeModules } from 'react-native';
import { storage } from '@/services/storage';
import { resources, defaultNS, SUPPORTED_LNGS, NS } from './resources';
import './types';

const STORAGE_KEY = 'protoimsg:language';
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/** JS-only device locale detection — avoids expo-localization native module. */
function getDeviceLanguage(): string {
  try {
    if (Platform.OS === 'ios') {
      const mgr = NativeModules.SettingsManager as
        | { settings?: Record<string, unknown> }
        | undefined;
      const settings = mgr?.settings ?? {};
      const appleLocale = settings.AppleLocale;
      if (typeof appleLocale === 'string') return appleLocale.split('_')[0] ?? 'en';
      const langs = settings.AppleLanguages;
      if (Array.isArray(langs) && typeof langs[0] === 'string')
        return langs[0].split('-')[0] ?? 'en';
    } else {
      // Android: try getConstants() first (RN 0.83+), then direct property access
      const i18nMgr = NativeModules.I18nManager as Record<string, unknown> | undefined;
      const constants =
        typeof (i18nMgr as { getConstants?: unknown } | undefined)?.getConstants === 'function'
          ? (i18nMgr as { getConstants: () => Record<string, unknown> }).getConstants()
          : i18nMgr;
      const localeId = constants?.localeIdentifier;
      if (typeof localeId === 'string') return localeId.split('_')[0] ?? 'en';
    }
  } catch {
    /* fall through */
  }
  return 'en';
}

// Read stored language synchronously (MMKV is sync, unlike AsyncStorage)
function detectLanguage(): string {
  const stored = storage.getString(STORAGE_KEY);
  if (stored && (SUPPORTED_LNGS as readonly string[]).includes(stored)) return stored;

  const deviceLang = getDeviceLanguage();
  return (SUPPORTED_LNGS as readonly string[]).includes(deviceLang) ? deviceLang : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  defaultNS,
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LNGS],
  ns: [...NS],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// Ensure RTL state matches current language on startup
const detectedLang = detectLanguage();
const shouldBeRTL = RTL_LANGUAGES.has(detectedLang.split('-')[0] ?? detectedLang);
if (I18nManager.isRTL !== shouldBeRTL) {
  I18nManager.forceRTL(shouldBeRTL);
  I18nManager.allowRTL(shouldBeRTL);
}

// Persist language + handle RTL on change
i18n.on('languageChanged', (lng) => {
  storage.set(STORAGE_KEY, lng);
  const isRTL = RTL_LANGUAGES.has(lng.split('-')[0] ?? lng);
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.forceRTL(isRTL);
    I18nManager.allowRTL(isRTL);
    // forceRTL only takes effect after app restart — prompt the user
    Alert.alert(
      i18n.t('common:rtlRestart.title', { defaultValue: 'Restart Required' }),
      i18n.t('common:rtlRestart.message', {
        defaultValue: 'Please restart the app for the layout direction to update.',
      }),
    );
  }
});

export default i18n;
