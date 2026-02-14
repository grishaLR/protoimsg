import { useTranslation } from 'react-i18next';
import styles from './BuddyListPanel.module.css';

const OFFLINE_GROUP = 'Offline';

/** Map known default group names to i18n keys */
const GROUP_I18N_KEYS: Record<string, string> = {
  'Inner Circle': 'buddyList.groups.innerCircle',
  Community: 'buddyList.groups.community',
  Offline: 'buddyList.groups.offline',
  Blocked: 'buddyList.groups.blocked',
};

export interface GroupHeaderRowProps {
  groupName: string;
  onlineCount: number;
  totalCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isProtected: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}

export function GroupHeaderRow({
  groupName,
  onlineCount,
  totalCount,
  isCollapsed,
  onToggleCollapse,
  isProtected,
  onRename,
  onDelete,
}: GroupHeaderRowProps) {
  const { t } = useTranslation('chat');
  const isSynthetic = groupName === OFFLINE_GROUP;

  return (
    <div className={styles.groupHeader} onClick={onToggleCollapse}>
      <button
        className={styles.collapseBtn}
        aria-label={isCollapsed ? t('groupHeader.expand') : t('groupHeader.collapse')}
      >
        {isCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      <span className={styles.groupName}>
        {GROUP_I18N_KEYS[groupName]
          ? t(GROUP_I18N_KEYS[groupName] as 'buddyList.groups.offline')
          : groupName}
      </span>
      {!isSynthetic && !isProtected && (
        <span
          className={styles.groupHeaderActions}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {onRename && (
            <button
              className={styles.groupActionBtn}
              onClick={onRename}
              title={t('groupHeader.renameGroup')}
            >
              &#9998;
            </button>
          )}
          {onDelete && (
            <button
              className={styles.groupActionBtn}
              onClick={onDelete}
              title={t('groupHeader.deleteGroup')}
            >
              &times;
            </button>
          )}
        </span>
      )}
      <span className={styles.groupCount}>
        ({onlineCount}/{totalCount})
      </span>
    </div>
  );
}
