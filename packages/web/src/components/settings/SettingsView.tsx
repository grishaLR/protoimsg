import { useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useProfileEditor } from '../../hooks/useProfileEditor';
import { useTheme } from '../../hooks/useTheme';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import styles from './SettingsView.module.css';

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { did, handle, logout } = useAuth();
  const { theme, setTheme } = useTheme();
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
        &larr; Back
      </button>

      <div className={styles.scrollArea}>
        {/* Account Info */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Account Info</div>
          <div className={styles.sectionBody}>
            <label className={styles.label}>DID</label>
            <input className={styles.readOnly} value={did ?? ''} readOnly />
            <label className={styles.label}>Handle</label>
            <input className={styles.readOnly} value={handle ?? ''} readOnly />
          </div>
        </div>

        {/* Edit Profile */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Edit Profile</div>
          <div className={styles.sectionBody}>
            {loading ? (
              <div className={styles.loadingText}>Loading profile...</div>
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
                    Change Avatar
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarChange}
                  />
                </div>

                <label className={styles.label}>Display Name</label>
                <input
                  className={styles.input}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                  }}
                />

                <label className={styles.label}>Bio</label>
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
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Appearance</div>
          <div className={styles.sectionBody}>
            <select
              className={styles.themeSelect}
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value as Theme);
              }}
            >
              {THEME_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Actions</div>
          <div className={styles.sectionBody}>
            <button
              className={styles.signOutButton}
              onClick={() => {
                logout();
              }}
              type="button"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
