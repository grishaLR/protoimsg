import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useVirtualList } from 'virtualized-ui';
import type { Agent } from '@atproto/api';
import type { BuddyGroup } from '@chatmosphere/lexicon';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { resolveDidOrHandle } from '../../lib/resolve-identity';
import { useBlocks } from '../../contexts/BlockContext';
import { useCollapsedGroups } from '../../hooks/useCollapsedGroups';
import type { DoorEvent } from '../../hooks/useBuddyList';
import type { BuddyWithPresence, BuddyListRow } from '../../types';
import styles from './BuddyListPanel.module.css';

interface BuddyListPanelProps {
  buddies: BuddyWithPresence[];
  groups: BuddyGroup[];
  doorEvents?: Record<string, DoorEvent>;
  loading: boolean;
  agent: Agent | null;
  onAddBuddy: (did: string) => Promise<void>;
  onRemoveBuddy: (did: string) => Promise<void>;
  onToggleCloseFriend: (did: string) => Promise<void>;
  onBlockBuddy: (did: string) => void;
  onSendIm?: (did: string) => void;
  onBuddyClick?: (did: string) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (oldName: string, newName: string) => Promise<void>;
  onDeleteGroup: (name: string) => Promise<void>;
  onMoveBuddy: (did: string, fromGroup: string, toGroup: string) => Promise<void>;
}

const OFFLINE_GROUP = 'Offline';
const BLOCKED_GROUP = 'Blocked';
const PROTECTED_GROUPS = new Set(['Buddies', 'Close Friends']);

const STATUS_ORDER: Record<string, number> = {
  online: 0,
  away: 1,
  idle: 2,
};

function BuddyMenu({
  buddy,
  groupName,
  allGroups,
  isBlocked,
  onRemove,
  onToggleCloseFriend,
  onBlock,
  onSendIm,
  onMoveBuddy,
}: {
  buddy: BuddyWithPresence;
  groupName: string;
  allGroups: BuddyGroup[];
  isBlocked: boolean;
  onRemove: () => void;
  onToggleCloseFriend: () => void;
  onBlock: () => void;
  onSendIm?: () => void;
  onMoveBuddy: (fromGroup: string, toGroup: string) => void;
}) {
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
        title="Options"
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
              Send IM
            </button>
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              onToggleCloseFriend();
              setOpen(false);
            }}
          >
            {buddy.isCloseFriend ? 'Remove from Close Friends' : 'Add to Close Friends'}
          </button>
          {groupName !== OFFLINE_GROUP && moveTargets.length > 0 && (
            <div className={styles.moveSubmenu}>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setMoveOpen(!moveOpen);
                }}
              >
                <span>Move to...</span>{' '}
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
                    {g.name}
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
            {isBlocked ? 'Unblock' : 'Block'}
          </button>
          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function GroupHeaderRow({
  groupName,
  onlineCount,
  totalCount,
  isCollapsed,
  onToggleCollapse,
  isProtected,
  onRename,
  onDelete,
}: {
  groupName: string;
  onlineCount: number;
  totalCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isProtected: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}) {
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

export function BuddyListPanel({
  buddies,
  groups,
  doorEvents = {},
  loading,
  agent,
  onAddBuddy,
  onRemoveBuddy,
  onToggleCloseFriend,
  onBlockBuddy,
  onSendIm,
  onBuddyClick,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveBuddy,
}: BuddyListPanelProps) {
  const { blockedDids } = useBlocks();
  const { collapsed, toggle: toggleCollapse } = useCollapsedGroups();
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Build presence map from flat buddies array
  const presenceMap = useMemo(() => {
    const map = new Map<string, BuddyWithPresence>();
    for (const b of buddies) {
      map.set(b.did, b);
    }
    return map;
  }, [buddies]);

  // Build flat rows for virtualization
  const rows: BuddyListRow[] = useMemo(() => {
    const result: BuddyListRow[] = [];
    const offlineBuddies = new Map<string, BuddyWithPresence>();

    const seenOnline = new Set<string>();
    // Render Close Friends first so its members are claimed before Buddies
    const sortedGroups = [...groups].sort((a, b) =>
      a.isCloseFriends === b.isCloseFriends ? 0 : a.isCloseFriends ? -1 : 1,
    );

    for (const group of sortedGroups) {
      const onlineMembers: BuddyWithPresence[] = [];
      let totalInGroup = 0;

      for (const member of group.members) {
        const buddy = presenceMap.get(member.did);
        if (!buddy) continue;
        // Skip blocked — they go in the synthetic Blocked group
        if (blockedDids.has(buddy.did)) continue;
        totalInGroup++;

        if (buddy.status === 'offline') {
          // Collect for synthetic Offline group (deduplicated)
          if (!offlineBuddies.has(buddy.did)) {
            offlineBuddies.set(buddy.did, buddy);
          }
        } else if (!seenOnline.has(buddy.did)) {
          onlineMembers.push(buddy);
          seenOnline.add(buddy.did);
        }
      }

      // Sort online members by status
      onlineMembers.sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));

      const onlineCount = onlineMembers.length;
      const isGroupCollapsed = collapsed.has(group.name);

      // Always push the group header
      result.push({
        type: 'group-header',
        groupName: group.name,
        onlineCount,
        totalCount: totalInGroup,
        isCollapsed: isGroupCollapsed,
      });

      // Push online buddy rows if not collapsed
      if (!isGroupCollapsed) {
        for (const buddy of onlineMembers) {
          result.push({ type: 'buddy', buddy, groupName: group.name });
        }
      }
    }

    // Synthetic "Offline" group at the bottom
    if (offlineBuddies.size > 0) {
      const offlineArray = [...offlineBuddies.values()];
      const isOfflineCollapsed = collapsed.has(OFFLINE_GROUP);

      result.push({
        type: 'group-header',
        groupName: OFFLINE_GROUP,
        onlineCount: 0,
        totalCount: offlineArray.length,
        isCollapsed: isOfflineCollapsed,
      });

      if (!isOfflineCollapsed) {
        for (const buddy of offlineArray) {
          result.push({ type: 'buddy', buddy, groupName: OFFLINE_GROUP });
        }
      }
    }

    // Synthetic "Blocked" group at the very bottom
    if (blockedDids.size > 0) {
      const blockedArray: BuddyWithPresence[] = [...blockedDids].map(
        (did) => presenceMap.get(did) ?? { did, status: 'offline', addedAt: '' },
      );
      const isBlockedCollapsed = collapsed.has(BLOCKED_GROUP);

      result.push({
        type: 'group-header',
        groupName: BLOCKED_GROUP,
        onlineCount: 0,
        totalCount: blockedArray.length,
        isCollapsed: isBlockedCollapsed,
      });

      if (!isBlockedCollapsed) {
        for (const buddy of blockedArray) {
          result.push({ type: 'buddy', buddy, groupName: BLOCKED_GROUP });
        }
      }
    }

    return result;
  }, [groups, presenceMap, collapsed, blockedDids]);

  const { virtualItems, totalSize, containerRef, handleScroll, measureElement, data } =
    useVirtualList({
      data: rows,
      getItemId: (row) =>
        row.type === 'group-header' ? `gh:${row.groupName}` : `b:${row.groupName}:${row.buddy.did}`,
      estimatedItemHeight: 28,
    });

  const handleAdd = async () => {
    const input = addInput.trim();
    if (!input || !agent) return;
    setAdding(true);
    setAddError(null);
    try {
      const did = await resolveDidOrHandle(agent, input);
      await onAddBuddy(did);
      setAddInput('');
    } catch {
      setAddError(`Could not resolve "${input}"`);
    } finally {
      setAdding(false);
    }
  };

  const handleCreateGroup = useCallback(async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setCreatingGroup(false);
      return;
    }
    await onCreateGroup(trimmed);
    setNewGroupName('');
    setCreatingGroup(false);
  }, [newGroupName, onCreateGroup]);

  const handleRenameGroup = useCallback(async () => {
    if (!renamingGroup) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== renamingGroup) {
      await onRenameGroup(renamingGroup, trimmed);
    }
    setRenamingGroup(null);
    setRenameValue('');
  }, [renamingGroup, renameValue, onRenameGroup]);

  const hasAnyRows = rows.length > 0;

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Buddy List</h3>

      <div className={styles.addSection}>
        <input
          className={styles.addInput}
          type="text"
          placeholder="Add buddy (DID or handle)..."
          value={addInput}
          onChange={(e) => {
            setAddInput(e.target.value);
            setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
          disabled={adding}
        />
        <button className={styles.addBtn} onClick={() => void handleAdd()} disabled={adding}>
          Add
        </button>
      </div>
      {addError && <p className={styles.addError}>{addError}</p>}

      {loading ? (
        <p className={styles.empty}>Loading...</p>
      ) : !hasAnyRows ? (
        <p className={styles.empty}>No buddies yet</p>
      ) : (
        <div className={styles.list} ref={containerRef} onScroll={handleScroll}>
          <div className={styles.spacer} style={{ height: totalSize }}>
            {virtualItems.map((vi) => {
              const row = data[vi.index] as BuddyListRow;

              if (row.type === 'group-header') {
                const isProtected = PROTECTED_GROUPS.has(row.groupName);
                const isSynthetic =
                  row.groupName === OFFLINE_GROUP || row.groupName === BLOCKED_GROUP;
                const isEmpty = row.totalCount === 0;

                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={measureElement}
                    className={styles.virtualItem}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {renamingGroup === row.groupName ? (
                      <div className={styles.groupHeader}>
                        <input
                          className={styles.createGroupInput}
                          autoFocus
                          value={renameValue}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRenameGroup();
                            if (e.key === 'Escape') {
                              setRenamingGroup(null);
                              setRenameValue('');
                            }
                          }}
                          onBlur={() => void handleRenameGroup()}
                        />
                      </div>
                    ) : (
                      <GroupHeaderRow
                        groupName={row.groupName}
                        onlineCount={row.onlineCount}
                        totalCount={row.totalCount}
                        isCollapsed={row.isCollapsed}
                        onToggleCollapse={() => {
                          toggleCollapse(row.groupName);
                        }}
                        isProtected={isProtected || isSynthetic}
                        onRename={
                          !isProtected && !isSynthetic
                            ? () => {
                                setRenamingGroup(row.groupName);
                                setRenameValue(row.groupName);
                              }
                            : undefined
                        }
                        onDelete={
                          !isProtected && !isSynthetic && isEmpty
                            ? () => void onDeleteGroup(row.groupName)
                            : undefined
                        }
                      />
                    )}
                  </div>
                );
              }

              // Buddy row
              const buddy = row.buddy;
              const door = doorEvents[buddy.did];
              const hasAwayMessage = buddy.awayMessage && buddy.status !== 'offline';

              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={measureElement}
                  className={`${styles.virtualItem} ${styles.buddy} ${styles.buddyIndented}`}
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {door ? (
                    <span className={styles.doorEmoji}>
                      {door === 'join' ? '\u{1F6AA}\u{2728}' : '\u{1F6AA}\u{1F4A8}'}
                    </span>
                  ) : hasAwayMessage ? (
                    <span className={styles.awayBubble} data-tooltip={buddy.awayMessage}>
                      <svg
                        className={styles.awayBubbleSvg}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6l-3 2.5V11H2a1 1 0 0 1-1-1V3z"
                          fill="#f59e0b"
                        />
                        <circle cx="5.5" cy="6" r="0.75" fill="#fff" />
                        <circle cx="8" cy="6" r="0.75" fill="#fff" />
                        <circle cx="10.5" cy="6" r="0.75" fill="#fff" />
                      </svg>
                    </span>
                  ) : (
                    <StatusIndicator status={buddy.status} />
                  )}
                  <div className={styles.buddyInfo}>
                    <span
                      className={styles.buddyDid}
                      role={onBuddyClick ? 'button' : undefined}
                      tabIndex={onBuddyClick ? 0 : undefined}
                      style={onBuddyClick ? { cursor: 'pointer' } : undefined}
                      onClick={
                        onBuddyClick
                          ? () => {
                              onBuddyClick(buddy.did);
                            }
                          : undefined
                      }
                      onKeyDown={
                        onBuddyClick
                          ? (e) => {
                              if (e.key === 'Enter') onBuddyClick(buddy.did);
                            }
                          : undefined
                      }
                    >
                      <UserIdentity did={buddy.did} showAvatar />
                    </span>
                  </div>
                  <BuddyMenu
                    buddy={buddy}
                    groupName={row.groupName}
                    allGroups={groups}
                    isBlocked={blockedDids.has(buddy.did)}
                    onRemove={() => void onRemoveBuddy(buddy.did)}
                    onToggleCloseFriend={() => void onToggleCloseFriend(buddy.did)}
                    onBlock={() => {
                      onBlockBuddy(buddy.did);
                    }}
                    onSendIm={
                      onSendIm
                        ? () => {
                            onSendIm(buddy.did);
                          }
                        : undefined
                    }
                    onMoveBuddy={(fromGroup, toGroup) => {
                      void onMoveBuddy(buddy.did, fromGroup, toGroup);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create group UI */}
      {creatingGroup ? (
        <div className={styles.addSection}>
          <input
            className={styles.createGroupInput}
            autoFocus
            placeholder="Group name..."
            value={newGroupName}
            onChange={(e) => {
              setNewGroupName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateGroup();
              if (e.key === 'Escape') {
                setCreatingGroup(false);
                setNewGroupName('');
              }
            }}
            onBlur={() => void handleCreateGroup()}
          />
        </div>
      ) : (
        <button
          className={styles.createGroupBtn}
          onClick={() => {
            setCreatingGroup(true);
          }}
        >
          + Create Group
        </button>
      )}
    </div>
  );
}
