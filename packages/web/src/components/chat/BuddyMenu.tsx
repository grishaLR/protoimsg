import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommunityGroup } from '@protoimsg/lexicon';
import type { MemberWithPresence } from '../../types';
import styles from './BuddyListPanel.module.css';

const OFFLINE_GROUP = 'Offline';
const BLOCKED_GROUP = 'Blocked';

const GROUP_I18N_KEYS: Record<string, string> = {
  'Inner Circle': 'buddyList.groups.innerCircle',
  Community: 'buddyList.groups.community',
};

export interface BuddyMenuProps {
  buddy: MemberWithPresence;
  groupName: string;
  allGroups: CommunityGroup[];
  isBlocked: boolean;
  onRemove: () => void;
  onToggleInnerCircle: () => void;
  onBlock: () => void;
  onSendIm?: () => void;
  onMoveBuddy: (fromGroup: string, toGroup: string) => void;
}

export function BuddyMenu({
  buddy,
  groupName,
  allGroups,
  isBlocked,
  onRemove,
  onToggleInnerCircle,
  onBlock,
  onSendIm,
  onMoveBuddy,
}: BuddyMenuProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMoveOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  const moveTargets = allGroups.filter(
    (g) => g.name !== groupName && g.name !== OFFLINE_GROUP && g.name !== BLOCKED_GROUP,
  );

  return (
    <div className={styles.menuWrap} ref={menuRef}>
      <button
        className={styles.menuBtn}
        onClick={() => {
          setOpen(!open);
        }}
        title={t('buddyMenu.button.title')}
        aria-label={t('buddyMenu.button.ariaLabel')}
      >
        <span className={styles.menuIcon} />
      </button>
      {open && (
        <div className={styles.menuDropdown}>
          {onSendIm && (
            <button
              className={styles.menuItem}
              onClick={() => {
                onSendIm();
                setOpen(false);
              }}
            >
              {t('buddyMenu.sendIm')}
            </button>
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              onToggleInnerCircle();
              setOpen(false);
            }}
          >
            {buddy.isInnerCircle
              ? t('buddyMenu.removeFromInnerCircle')
              : t('buddyMenu.addToInnerCircle')}
          </button>
          {groupName !== OFFLINE_GROUP && moveTargets.length > 0 && (
            <div className={styles.moveSubmenu}>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setMoveOpen(!moveOpen);
                }}
              >
                <span>{t('buddyMenu.moveTo')}</span>{' '}
                <span className={styles.moveCaret}>{moveOpen ? '\u25B2' : '\u25BC'}</span>
              </button>
              {moveOpen &&
                moveTargets.map((g) => (
                  <button
                    key={g.name}
                    className={styles.moveTarget}
                    onClick={() => {
                      onMoveBuddy(groupName, g.name);
                      setOpen(false);
                      setMoveOpen(false);
                    }}
                  >
                    {GROUP_I18N_KEYS[g.name]
                      ? t(GROUP_I18N_KEYS[g.name] as 'buddyList.groups.innerCircle')
                      : g.name}
                  </button>
                ))}
            </div>
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              onBlock();
              setOpen(false);
            }}
          >
            {isBlocked ? t('buddyMenu.unblock') : t('buddyMenu.block')}
          </button>
          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
          >
            {t('buddyMenu.remove')}
          </button>
        </div>
      )}
    </div>
  );
}
