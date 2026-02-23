import { useTranslation } from 'react-i18next';
import styles from './LanguageSelector.module.css';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '简体中文 (Mandarin)' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ภาษาไทย' },
  { code: 'ga', label: 'Gaeilge' },
  // NLLB-only languages — hidden while NLLB is sidelined
  // { code: 'sw', label: 'Kiswahili' },
  // { code: 'ha', label: 'Hausa' },
] as const;

export function LanguageSelector() {
  const { i18n } = useTranslation();

  return (
    <select
      className={styles.select}
      value={i18n.language}
      onChange={(e) => {
        void i18n.changeLanguage(e.target.value);
      }}
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
