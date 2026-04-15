import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { THEME_OPTIONS, type Theme } from '../../contexts/ThemeContext';
import { ArrowLeft } from 'lucide-react';
import { LanguageSelector } from './LanguageSelector';
import { InfoTip } from '@protoimsg/ui/InfoTip';
import { isSoundEnabled, setSoundEnabled } from '../../lib/sounds';
import type { IpProtectionLevel } from '../../contexts/VideoCallContext';
import styles from './SettingsView.module.css';

type PasswordStep = 'idle' | 'codeSent' | 'success';

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { did, handle, agent, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled);
  const [ipProtection, setIpProtection] = useState<IpProtectionLevel>(() => {
    const stored = localStorage.getItem('protoimsg:ipProtection');
    if (stored === 'non-inner-circle' || stored === 'all') return stored;
    return 'non-inner-circle';
  });

  // Change password state
  const [pwStep, setPwStep] = useState<PasswordStep>('idle');
  const [pwEmail, setPwEmail] = useState('');
  const [pwToken, setPwToken] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  const resetPasswordState = useCallback(() => {
    setPwStep('idle');
    setPwEmail('');
    setPwToken('');
    setPwNew('');
    setPwConfirm('');
    setPwBusy(false);
    setPwError('');
  }, []);

  const handleRequestCode = useCallback(async () => {
    if (!agent || !pwEmail.trim()) return;
    setPwBusy(true);
    setPwError('');
    try {
      await agent.com.atproto.server.requestPasswordReset({ email: pwEmail.trim() });
      setPwStep('codeSent');
    } catch {
      setPwError(t('changePassword.error.default'));
    } finally {
      setPwBusy(false);
    }
  }, [agent, pwEmail, t]);

  const handleChangePassword = useCallback(async () => {
    if (!agent) return;
    if (pwNew.length < 8) {
      setPwError(t('changePassword.error.tooShort'));
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError(t('changePassword.error.mismatch'));
      return;
    }
    setPwBusy(true);
    setPwError('');
    try {
      await agent.com.atproto.server.resetPassword({
        token: pwToken.trim(),
        password: pwNew,
      });
      setPwStep('success');
      setTimeout(resetPasswordState, 4000);
    } catch {
      setPwError(t('changePassword.error.invalidToken'));
    } finally {
      setPwBusy(false);
    }
  }, [agent, pwNew, pwConfirm, pwToken, t, resetPasswordState]);

  return (
    <div className={styles.settingsView}>
      <button className={styles.backButton} onClick={onBack}>
        <ArrowLeft size={14} /> {t('back')}
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

        {/* Change Password */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('changePassword.title')}</div>
          <div className={styles.sectionBody}>
            {pwStep === 'idle' && (
              <>
                <div className={styles.hint}>{t('changePassword.description')}</div>
                <label className={styles.label}>{t('changePassword.emailLabel')}</label>
                <input
                  className={styles.input}
                  type="email"
                  value={pwEmail}
                  onChange={(e) => {
                    setPwEmail(e.target.value);
                  }}
                  placeholder={t('changePassword.emailPlaceholder')}
                />
                {pwError && <div className={styles.error}>{pwError}</div>}
                <button
                  className={styles.saveButton}
                  onClick={() => {
                    void handleRequestCode();
                  }}
                  disabled={pwBusy || !pwEmail.trim()}
                  type="button"
                >
                  {pwBusy ? t('changePassword.requesting') : t('changePassword.requestCode')}
                </button>
                <button
                  className={styles.linkButton}
                  onClick={() => {
                    setPwStep('codeSent');
                    setPwError('');
                  }}
                  type="button"
                >
                  {t('changePassword.alreadyHaveCode')}
                </button>
              </>
            )}
            {pwStep === 'codeSent' && (
              <>
                <div className={styles.hint}>{t('changePassword.codeSent')}</div>
                <label className={styles.label}>{t('changePassword.tokenLabel')}</label>
                <input
                  className={styles.input}
                  value={pwToken}
                  onChange={(e) => {
                    setPwToken(e.target.value);
                  }}
                  placeholder={t('changePassword.tokenPlaceholder')}
                />
                <label className={styles.label}>{t('changePassword.newPasswordLabel')}</label>
                <input
                  className={styles.input}
                  type="password"
                  value={pwNew}
                  onChange={(e) => {
                    setPwNew(e.target.value);
                  }}
                  placeholder={t('changePassword.newPasswordPlaceholder')}
                />
                <label className={styles.label}>{t('changePassword.confirmPasswordLabel')}</label>
                <input
                  className={styles.input}
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => {
                    setPwConfirm(e.target.value);
                  }}
                  placeholder={t('changePassword.confirmPasswordPlaceholder')}
                />
                {pwError && <div className={styles.error}>{pwError}</div>}
                <button
                  className={styles.saveButton}
                  onClick={() => {
                    void handleChangePassword();
                  }}
                  disabled={pwBusy || !pwToken.trim() || !pwNew || !pwConfirm}
                  type="button"
                >
                  {pwBusy ? t('changePassword.submitting') : t('changePassword.submit')}
                </button>
                <button
                  className={styles.linkButton}
                  onClick={() => {
                    setPwStep('idle');
                    setPwError('');
                  }}
                  type="button"
                >
                  {t('changePassword.requestAnother')}
                </button>
              </>
            )}
            {pwStep === 'success' && (
              <div className={styles.successText}>{t('changePassword.success')}</div>
            )}
          </div>
        </div>

        {/* Language & Translation */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('language.title')}</div>
          <div className={styles.sectionBody}>
            <LanguageSelector />
          </div>
        </div>

        {/* Privacy */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('privacy.title')}</div>
          <div className={styles.sectionBody}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="ipProtection"
                checked={ipProtection === 'non-inner-circle'}
                onChange={() => {
                  setIpProtection('non-inner-circle');
                  localStorage.setItem('protoimsg:ipProtection', 'non-inner-circle');
                }}
              />
              {t('privacy.options.nonInnerCircle')}
              <InfoTip text={t('privacy.directConnectionInfo')} />
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="ipProtection"
                checked={ipProtection === 'all'}
                onChange={() => {
                  setIpProtection('all');
                  localStorage.setItem('protoimsg:ipProtection', 'all');
                }}
              />
              {t('privacy.options.all')}
              <InfoTip text={t('privacy.relayInfo')} />
            </label>
            <div className={styles.hintBlock}>{t('privacy.ipProtectionHint')}</div>
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

        {/* Notifications */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('notifications.title')}</div>
          <div className={styles.sectionBody}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => {
                  setSoundEnabledState(e.target.checked);
                  setSoundEnabled(e.target.checked);
                }}
              />
              {t('notifications.enableSounds')}
            </label>
            <div className={styles.hint}>{t('notifications.enableSoundsHint')}</div>
          </div>
        </div>

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
