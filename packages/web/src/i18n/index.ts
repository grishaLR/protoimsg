import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { defaultNS, resources } from './resources';
import './types';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

function updateDirection(lng: string) {
  const base = lng.split('-')[0] ?? lng;
  const dir = RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

void i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    fallbackLng: 'en',
    supportedLngs: [
      'en',
      'es',
      'ru',
      'ar',
      'ga',
      'uk',
      'zh',
      'hi',
      'ja',
      'ko',
      'vi',
      'fr',
      'pt',
      'de',
      'tr',
      'th',
    ],
    ns: ['common', 'auth', 'chat', 'dm', 'feed', 'rooms', 'settings', 'atproto'],

    interpolation: { escapeValue: false },

    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'protoimsg:language',
      caches: ['localStorage'],
    },

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    partialBundledLanguages: true,

    react: {
      useSuspense: false,
    },
  });

i18n.on('languageChanged', updateDirection);

// Set initial direction
updateDirection(i18n.language);

export default i18n;
