import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommunityGroup } from '@protoimsg/lexicon';
import { MoreVertical, Video, ChevronUp, ChevronDown } from 'lucide-react';
import { useGermDeclaration } from '../../hooks/useGermDeclaration';
import { useBlocks } from '../../contexts/BlockContext';
import type { MemberWithPresence } from '../../types';
import styles from './BuddyListPanel.module.css';

function GermMenuItem({ did, onClose }: { did: string; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { canMessage, germUrl } = useGermDeclaration(did);

  if (!canMessage || !germUrl) return null;

  return (
    <button
      className={styles.menuItem}
      onClick={() => {
        window.open(germUrl, '_blank', 'noopener,noreferrer');
        onClose();
      }}
    >
      {t('buddyMenu.messageOnGerm')}
    </button>
  );
}

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
  onVideoCall?: () => void;
  onMoveBuddy: (fromGroup: string, toGroup: string) => void;
  /** When set, shows "Add to Community" and hides community-only actions */
  onAddToCommunity?: () => void;
  /** True for entries in Followers/Following groups */
  isFollowGraphEntry?: boolean;
  onReport?: () => void;
}

function ReportButton({
  onReport,
  onClose,
  label,
}: {
  onReport: () => void;
  onClose: () => void;
  label: string;
}) {
  return (
    <button
      className={`${styles.menuItem} ${styles.menuItemDanger}`}
      onClick={() => {
        onReport();
        onClose();
      }}
    >
      {label}
    </button>
  );
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
  onVideoCall,
  onMoveBuddy,
  onAddToCommunity,
  isFollowGraphEntry,
  onReport,
}: BuddyMenuProps) {
  const { t } = useTranslation('common');
  const { canWriteBlocks } = useBlocks();
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

  const isOffline = buddy.status === 'offline';

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
        <MoreVertical size={12} />
      </button>
      {open && (
        <div className={styles.menuDropdown}>
          {isFollowGraphEntry ? (
            <>
              {onAddToCommunity && (
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    onAddToCommunity();
                    setOpen(false);
                  }}
                >
                  {t('buddyMenu.addToCommunity')}
                </button>
              )}
              {canWriteBlocks && (
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    onBlock();
                    setOpen(false);
                  }}
                >
                  {isBlocked ? t('buddyMenu.unblock') : t('buddyMenu.block')}
                </button>
              )}
              {onReport && (
                <ReportButton
                  onReport={onReport}
                  onClose={() => {
                    setOpen(false);
                  }}
                  label={t('buddyMenu.report')}
                />
              )}
            </>
          ) : (
            <>
              {onSendIm && (
                <button
                  className={`${styles.menuItem} ${isOffline ? styles.menuItemDisabled : ''}`}
                  disabled={isOffline}
                  onClick={() => {
                    onSendIm();
                    setOpen(false);
                  }}
                  title={isOffline ? t('buddyMenu.sendImDisabled') : undefined}
                >
                  {t('buddyMenu.sendIm')}
                </button>
              )}
              {onVideoCall && (
                <button
                  className={`${styles.menuItem} ${isOffline ? styles.menuItemDisabled : ''}`}
                  disabled={isOffline}
                  onClick={() => {
                    onVideoCall();
                    setOpen(false);
                  }}
                  title={isOffline ? t('buddyMenu.videoCallDisabled') : undefined}
                >
                  <Video size={14} /> {t('buddyMenu.videoCall')}
                </button>
              )}
              <GermMenuItem
                did={buddy.did}
                onClose={() => {
                  setOpen(false);
                }}
              />
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
                    <span className={styles.moveCaret}>
                      {moveOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </span>
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
              {canWriteBlocks && (
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    onBlock();
                    setOpen(false);
                  }}
                >
                  {isBlocked ? t('buddyMenu.unblock') : t('buddyMenu.block')}
                </button>
              )}
              {onReport && (
                <ReportButton
                  onReport={onReport}
                  onClose={() => {
                    setOpen(false);
                  }}
                  label={t('buddyMenu.report')}
                />
              )}
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
              >
                {t('buddyMenu.remove')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
