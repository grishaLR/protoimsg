import { useTranslation } from 'react-i18next';
import styles from './LanguageSelector.module.css';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espa\u00f1ol' },
  { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
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
