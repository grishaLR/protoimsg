import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { usePresence } from '../../hooks/usePresence';
import { StatusIndicator } from '../chat/StatusIndicator';
import { WindowControls } from './WindowControls';
import { IS_TAURI } from '../../lib/config';
import { STATUS_OPTIONS, VISIBILITY_OPTIONS } from '../../constants/presence';
import styles from './Header.module.css';

interface HeaderProps {
  onOpenSettings?: () => void;
}

export function Header({ onOpenSettings }: HeaderProps) {
  const { t } = useTranslation('common');
  const { did, logout } = useAuth();
  const { status, awayMessage, visibleTo, changeStatus } = usePresence();
  const [open, setOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState(awayMessage ?? '');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  // Sync draft when awayMessage changes externally
  useEffect(() => {
    setDraftMessage(awayMessage ?? '');
  }, [awayMessage]);

  const handleMinimize = () => {
    void import('../../lib/tauri-windows').then(({ minimizeCurrentWindow }) => {
      void minimizeCurrentWindow();
    });
    setOpen(false);
  };

  return (
    <header className={styles.header} data-tauri-drag-region="">
      <h1 className={styles.title}>{t('appName')}</h1>
      <div className={styles.right}>
        {did && (
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              className={styles.hamburger}
              onClick={() => {
                setOpen(!open);
              }}
              title={t('header.menu')}
            >
              <span className={styles.hamburgerIcon} />
            </button>
            {open && (
              <div className={styles.dropdown}>
                {/* Status options */}
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`${styles.dropdownItem} ${styles.statusItem} ${status === opt.value ? styles.statusActive : ''}`}
                    onClick={() => {
                      if (opt.value !== 'away') {
                        changeStatus(opt.value);
                      } else {
                        changeStatus('away', draftMessage || undefined);
                      }
                      setOpen(false);
                    }}
                  >
                    <StatusIndicator status={opt.value} />
                    {t(opt.labelKey as 'status.online')}
                  </button>
                ))}

                {/* Away message */}
                <div className={styles.awaySection}>
                  <label className={styles.awayLabel}>{t('header.awayMessage.label')}</label>
                  <input
                    className={styles.awayInput}
                    type="text"
                    placeholder={t('header.awayMessage.placeholder')}
                    maxLength={300}
                    value={draftMessage}
                    onChange={(e) => {
                      setDraftMessage(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        changeStatus('away', draftMessage || undefined);
                        setOpen(false);
                      }
                    }}
                  />
                </div>

                {/* Visibility */}
                <div className={styles.visibilitySection}>
                  <label className={styles.visibilityLabel}>{t('header.visibility.label')}</label>
                  <div className={styles.visibilityOptions}>
                    {VISIBILITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`${styles.visibilityBtn} ${visibleTo === opt.value ? styles.visibilityActive : ''}`}
                        onClick={() => {
                          changeStatus(
                            status,
                            status === 'away' ? draftMessage || undefined : undefined,
                            opt.value,
                          );
                          setOpen(false);
                        }}
                      >
                        {t(opt.labelKey as 'visibility.everyone')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.dropdownSeparator} />

                {/* Settings */}
                {onOpenSettings && (
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      onOpenSettings();
                      setOpen(false);
                    }}
                  >
                    {'\u2699'} {t('header.settings')}
                  </button>
                )}

                {/* Minimize (Tauri only) */}
                {IS_TAURI && (
                  <button className={styles.dropdownItem} onClick={handleMinimize}>
                    {'\u2013'} {t('header.minimize')}
                  </button>
                )}

                {/* Sign Out */}
                <button
                  className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                  onClick={() => {
                    logout();
                    setOpen(false);
                  }}
                >
                  {t('header.signOut')}
                </button>
              </div>
            )}
          </div>
        )}
        <WindowControls showMinimize={false} />
      </div>
    </header>
  );
}
