import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useProfileEditor } from '../../hooks/useProfileEditor';
import { useTheme } from '../../hooks/useTheme';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import { LanguageSelector } from './LanguageSelector';
import styles from './SettingsView.module.css';

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { did, handle, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const {
    autoTranslate,
    setAutoTranslate,
    available: translateAvailable,
  } = useContentTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    displayName,
    setDisplayName,
    description,
    setDescription,
    setAvatarFile,
    avatarPreview,
    loading,
    saving,
    error,
    save,
  } = useProfileEditor();

  const handleAvatarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setAvatarFile(file);
      }
    },
    [setAvatarFile],
  );

  return (
    <div className={styles.settingsView}>
      <button className={styles.backButton} onClick={onBack}>
        {'\u2190'} {t('back')}
      </button>

      <div className={styles.scrollArea}>
        {/* Account Info */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('accountInfo.title')}</div>
          <div className={styles.sectionBody}>
            <label className={styles.label}>{t('accountInfo.didLabel')}</label>
            <input className={styles.readOnly} value={did ?? ''} readOnly />
            <label className={styles.label}>{t('accountInfo.handleLabel')}</label>
            <input className={styles.readOnly} value={handle ?? ''} readOnly />
          </div>
        </div>

        {/* Edit Profile */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('editProfile.title')}</div>
          <div className={styles.sectionBody}>
            {loading ? (
              <div className={styles.loadingText}>{t('editProfile.loading')}</div>
            ) : (
              <>
                <div className={styles.avatarRow}>
                  {avatarPreview && (
                    <img className={styles.avatarPreview} src={avatarPreview} alt="" />
                  )}
                  <button
                    className={styles.changeAvatarButton}
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    type="button"
                  >
                    {t('editProfile.changeAvatar')}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarChange}
                  />
                </div>

                <label className={styles.label}>{t('editProfile.displayNameLabel')}</label>
                <input
                  className={styles.input}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                  }}
                />

                <label className={styles.label}>{t('editProfile.bioLabel')}</label>
                <textarea
                  className={styles.textarea}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  rows={4}
                />

                {error && <div className={styles.error}>{error}</div>}

                <button
                  className={styles.saveButton}
                  onClick={() => {
                    void save();
                  }}
                  disabled={saving}
                  type="button"
                >
                  {saving ? t('editProfile.saving') : t('editProfile.save')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('appearance.title')}</div>
          <div className={styles.sectionBody}>
            <select
              className={styles.themeSelect}
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value as Theme);
              }}
            >
              {THEME_OPTIONS.map((themeOpt) => (
                <option key={themeOpt.id} value={themeOpt.id}>
                  {tc(themeOpt.labelKey as 'theme.aim')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Language */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('language.title')}</div>
          <div className={styles.sectionBody}>
            <LanguageSelector />
          </div>
        </div>

        {/* Translation (only shown when available) */}
        {translateAvailable && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('translation.title')}</div>
            <div className={styles.sectionBody}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => {
                    setAutoTranslate(e.target.checked);
                  }}
                />
                {t('translation.autoTranslate')}
              </label>
              <div className={styles.hint}>{t('translation.autoTranslateHint')}</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('actions.title')}</div>
          <div className={styles.sectionBody}>
            <button
              className={styles.signOutButton}
              onClick={() => {
                logout();
              }}
              type="button"
            >
              {t('actions.signOut')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
