import styles from './BuddyListPanel.module.css';

const OFFLINE_GROUP = 'Offline';

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
  const isSynthetic = groupName === OFFLINE_GROUP;

  return (
    <div className={styles.groupHeader} onClick={onToggleCollapse}>
      <button className={styles.collapseBtn} aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
        {isCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      <span className={styles.groupName}>{groupName}</span>
      {!isSynthetic && !isProtected && (
        <span
          className={styles.groupHeaderActions}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {onRename && (
            <button className={styles.groupActionBtn} onClick={onRename} title="Rename group">
              &#9998;
            </button>
          )}
          {onDelete && (
            <button className={styles.groupActionBtn} onClick={onDelete} title="Delete group">
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
