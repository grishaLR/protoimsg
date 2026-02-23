import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { Menu, Settings, Minus } from 'lucide-react';
import { usePresence } from '../../hooks/usePresence';
import { StatusIndicator } from '../chat/StatusIndicator';
import { WindowControls } from './WindowControls';
import { FeedbackModal } from '../feedback/FeedbackModal';
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
  const [showFeedback, setShowFeedback] = useState(false);
  const [draftMessage, setDraftMessage] = useState(awayMessage ?? '');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        // Return focus to the hamburger button
        const btn = menuRef.current?.querySelector('button');
        btn?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
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
              aria-label={t('header.menu')}
              aria-haspopup="menu"
              aria-expanded={open}
              title={t('header.menu')}
            >
              <Menu size={14} />
            </button>
            {open && (
              <div className={styles.dropdown} role="menu">
                {/* Status options */}
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="menuitem"
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
                    role="menuitem"
                    className={styles.dropdownItem}
                    onClick={() => {
                      onOpenSettings();
                      setOpen(false);
                    }}
                  >
                    <Settings size={14} /> {t('header.settings')}
                  </button>
                )}

                {/* Send Feedback */}
                <button
                  role="menuitem"
                  className={styles.dropdownItem}
                  onClick={() => {
                    setShowFeedback(true);
                    setOpen(false);
                  }}
                >
                  {t('feedback.menuItem')}
                </button>

                {/* Minimize (Tauri only) */}
                {IS_TAURI && (
                  <button role="menuitem" className={styles.dropdownItem} onClick={handleMinimize}>
                    <Minus size={14} /> {t('header.minimize')}
                  </button>
                )}

                {/* Sign Out */}
                <button
                  role="menuitem"
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
      {showFeedback && (
        <FeedbackModal
          onClose={() => {
            setShowFeedback(false);
          }}
        />
      )}
    </header>
  );
}
