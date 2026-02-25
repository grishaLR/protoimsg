import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualList } from 'virtualized-ui';
import type { CommunityGroup } from '@protoimsg/lexicon';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { BuddyMenu } from './BuddyMenu';
import { GroupHeaderRow } from './GroupHeaderRow';
import { ActorSearch, type ActorSearchResult } from '../shared/ActorSearch';
import { useRotatingPlaceholder } from '../../hooks/useRotatingPlaceholder';
import { useBlocks } from '../../contexts/BlockContext';
import { useCollapsedGroups } from '../../hooks/useCollapsedGroups';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { ScrollableGroup } from './ScrollableGroup';
import { ReportUserModal } from '../feedback/ReportUserModal';
import type { FollowGraphEntry } from '../../hooks/useFollowGraph';
import type { DoorEvent } from '../../hooks/useBuddyList';
import type { MemberWithPresence, CommunityListRow } from '../../types';
import styles from './BuddyListPanel.module.css';

interface BuddyListPanelProps {
  buddies: MemberWithPresence[];
  groups: CommunityGroup[];
  doorEvents?: Record<string, DoorEvent>;
  loading: boolean;
  error?: Error | null;
  onAddBuddy: (did: string) => Promise<void>;
  onRemoveBuddy: (did: string) => Promise<void>;
  onToggleInnerCircle: (did: string) => Promise<void>;
  onBlockBuddy: (did: string) => void;
  imUnreadMap?: Map<string, number>;
  /** DIDs with pending IM notifications (incoming request, no messages yet) */
  imNotifySet?: Set<string>;
  onSendIm?: (did: string) => void;
  onVideoCall?: (did: string) => void;
  onBuddyClick?: (did: string) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (oldName: string, newName: string) => Promise<void>;
  onDeleteGroup: (name: string) => Promise<void>;
  onMoveBuddy: (did: string, fromGroup: string, toGroup: string) => Promise<void>;
  onOpenChatRooms?: () => void;
  onOpenFeed?: () => void;
  followers?: FollowGraphEntry[];
  following?: FollowGraphEntry[];
  fetchMoreFollowers?: () => void;
  fetchMoreFollowing?: () => void;
  hasMoreFollowers?: boolean;
  hasMoreFollowing?: boolean;
}

const OFFLINE_GROUP = 'Offline';
const BLOCKED_GROUP = 'Blocked';
const FOLLOWING_GROUP = 'Following';
const FOLLOWERS_GROUP = 'Followers';
const PROTECTED_GROUPS = new Set(['Community', 'Inner Circle']);

const STATUS_ORDER: Record<string, number> = {
  online: 0,
  away: 1,
  idle: 2,
};

export function BuddyListPanel({
  buddies,
  groups,
  doorEvents = {},
  loading,
  onAddBuddy,
  onRemoveBuddy,
  onToggleInnerCircle,
  onBlockBuddy,
  imUnreadMap,
  imNotifySet,
  onSendIm,
  onVideoCall,
  onBuddyClick,
  onCreateGroup: _onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveBuddy,
  onOpenChatRooms,
  onOpenFeed,
  error,
  followers = [],
  following = [],
  fetchMoreFollowers,
  fetchMoreFollowing,
  hasMoreFollowers,
  hasMoreFollowing,
}: BuddyListPanelProps) {
  const { t } = useTranslation('chat');
  const { blockedDids } = useBlocks();
  const { collapsed, toggle: toggleCollapse } = useCollapsedGroups();
  const {
    autoTranslate,
    available: translateAvailable,
    getTranslation,
    requestBatchTranslation,
  } = useContentTranslation();
  const lastAwayMsgHash = useRef('');
  const [reportDid, setReportDid] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const buddyDids = useMemo(() => new Set(buddies.map((b) => b.did)), [buddies]);

  const handleBuddySelect = useCallback(
    (actor: ActorSearchResult) => {
      void onAddBuddy(actor.did);
    },
    [onAddBuddy],
  );

  // Build presence map from flat buddies array
  const presenceMap = useMemo(() => {
    const map = new Map<string, MemberWithPresence>();
    for (const b of buddies) {
      map.set(b.did, b);
    }
    return map;
  }, [buddies]);

  // Auto-translate away messages
  useEffect(() => {
    if (!autoTranslate || !translateAvailable) return;
    const awayTexts = buddies
      .filter((b) => b.awayMessage && b.status !== 'offline')
      .map((b) => b.awayMessage as string);
    const hash = awayTexts.join('\0');
    if (hash === lastAwayMsgHash.current) return;
    lastAwayMsgHash.current = hash;
    if (awayTexts.length > 0) requestBatchTranslation(awayTexts);
  }, [buddies, autoTranslate, translateAvailable, requestBatchTranslation]);

  // Build flat rows for virtualization
  const rows: CommunityListRow[] = useMemo(() => {
    const result: CommunityListRow[] = [];
    const offlineBuddies = new Map<string, MemberWithPresence>();

    const seenOnline = new Set<string>();
    // Render Inner Circle first so its members are claimed before Buddies
    const sortedGroups = [...groups].sort((a, b) =>
      a.isInnerCircle === b.isInnerCircle ? 0 : a.isInnerCircle ? -1 : 1,
    );

    for (const group of sortedGroups) {
      const onlineMembers: MemberWithPresence[] = [];
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

    // Synthetic "Offline" group at the bottom (always visible)
    {
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
      const blockedArray: MemberWithPresence[] = [...blockedDids].map(
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

  const handleRenameGroup = useCallback(async () => {
    if (!renamingGroup) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== renamingGroup) {
      await onRenameGroup(renamingGroup, trimmed);
    }
    setRenamingGroup(null);
    setRenameValue('');
  }, [renamingGroup, renameValue, onRenameGroup]);

  // Filter follow-graph entries: exclude community members and blocked users
  const followingFiltered: MemberWithPresence[] = useMemo(
    () =>
      following
        .filter((f) => !buddyDids.has(f.did) && !blockedDids.has(f.did))
        .map((f) => ({ did: f.did, status: 'offline', addedAt: '' })),
    [following, buddyDids, blockedDids],
  );

  const followersFiltered: MemberWithPresence[] = useMemo(
    () =>
      followers
        .filter((f) => !buddyDids.has(f.did) && !blockedDids.has(f.did))
        .map((f) => ({ did: f.did, status: 'offline', addedAt: '' })),
    [followers, buddyDids, blockedDids],
  );

  const isFollowingCollapsed = collapsed.has(FOLLOWING_GROUP);
  const isFollowersCollapsed = collapsed.has(FOLLOWERS_GROUP);

  const hasAnyRows = rows.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.searchSection}>
        <label className={styles.searchLabel} htmlFor="add-buddy-search">
          {t('buddyList.addBuddyLabel')}
        </label>
        <AddBuddySearch onSelect={handleBuddySelect} buddyDids={buddyDids} />
      </div>

      {loading ? (
        <p className={styles.empty}>{t('buddyList.loading')}</p>
      ) : error ? (
        <p className={styles.empty} role="alert">
          {error.message}
        </p>
      ) : !hasAnyRows ? (
        <p className={styles.empty}>{t('buddyList.empty')}</p>
      ) : (
        <div className={styles.list} ref={containerRef} onScroll={handleScroll}>
          <div className={styles.spacer} style={{ height: totalSize }}>
            {virtualItems.map((vi) => {
              const row = data[vi.index] as CommunityListRow;

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
              const imUnreadCount = imUnreadMap?.get(buddy.did) ?? 0;
              const door = doorEvents[buddy.did];
              const hasAwayMessage = buddy.awayMessage && buddy.status !== 'offline';
              const awayTooltip = hasAwayMessage
                ? (autoTranslate && getTranslation(buddy.awayMessage as string)) ||
                  buddy.awayMessage
                : undefined;

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
                    <span className={styles.awayBubble} data-tooltip={awayTooltip}>
                      <svg
                        className={styles.awayBubbleSvg}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6l-3 2.5V11H2a1 1 0 0 1-1-1V3z"
                          fill="currentColor"
                        />
                        <circle cx="5.5" cy="6" r="0.75" fill="var(--color-base-100)" />
                        <circle cx="8" cy="6" r="0.75" fill="var(--color-base-100)" />
                        <circle cx="10.5" cy="6" r="0.75" fill="var(--color-base-100)" />
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
                  {imUnreadCount > 0 ? (
                    <button
                      className={styles.imUnreadBadge}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendIm?.(buddy.did);
                      }}
                      aria-label={t('buddyList.unreadIm', { count: imUnreadCount })}
                    >
                      {imUnreadCount > 99 ? '99+' : imUnreadCount}
                    </button>
                  ) : imNotifySet?.has(buddy.did) ? (
                    <button
                      className={`${styles.imUnreadBadge} ${styles.imNotifyDot}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendIm?.(buddy.did);
                      }}
                      aria-label={t('buddyList.incomingIm')}
                    />
                  ) : null}
                  <BuddyMenu
                    buddy={buddy}
                    groupName={row.groupName}
                    allGroups={groups}
                    isBlocked={blockedDids.has(buddy.did)}
                    onRemove={() => void onRemoveBuddy(buddy.did)}
                    onToggleInnerCircle={() => void onToggleInnerCircle(buddy.did)}
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
                    onVideoCall={
                      onVideoCall
                        ? () => {
                            onVideoCall(buddy.did);
                          }
                        : undefined
                    }
                    onMoveBuddy={(fromGroup, toGroup) => {
                      void onMoveBuddy(buddy.did, fromGroup, toGroup);
                    }}
                    onReport={() => {
                      setReportDid(buddy.did);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Following group */}
      {followingFiltered.length > 0 && (
        <>
          <GroupHeaderRow
            groupName={FOLLOWING_GROUP}
            onlineCount={0}
            totalCount={followingFiltered.length + (hasMoreFollowing ? 1 : 0)}
            isCollapsed={isFollowingCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(FOLLOWING_GROUP);
            }}
            isProtected
          />
          {!isFollowingCollapsed && (
            <ScrollableGroup
              items={followingFiltered}
              groupName={FOLLOWING_GROUP}
              allGroups={groups}
              onLoadMore={fetchMoreFollowing}
              hasMore={hasMoreFollowing}
              onBuddyClick={onBuddyClick}
              onAddToCommunity={(did) => void onAddBuddy(did)}
              onBlock={onBlockBuddy}
              onReport={(did) => {
                setReportDid(did);
              }}
              blockedDids={blockedDids}
            />
          )}
        </>
      )}

      {/* Followers group */}
      {followersFiltered.length > 0 && (
        <>
          <GroupHeaderRow
            groupName={FOLLOWERS_GROUP}
            onlineCount={0}
            totalCount={followersFiltered.length + (hasMoreFollowers ? 1 : 0)}
            isCollapsed={isFollowersCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(FOLLOWERS_GROUP);
            }}
            isProtected
          />
          {!isFollowersCollapsed && (
            <ScrollableGroup
              items={followersFiltered}
              groupName={FOLLOWERS_GROUP}
              allGroups={groups}
              onLoadMore={fetchMoreFollowers}
              hasMore={hasMoreFollowers}
              onBuddyClick={onBuddyClick}
              onAddToCommunity={(did) => void onAddBuddy(did)}
              onBlock={onBlockBuddy}
              onReport={(did) => {
                setReportDid(did);
              }}
              blockedDids={blockedDids}
            />
          )}
        </>
      )}

      {/* Create group UI — hidden until feature is ready */}

      {(onOpenChatRooms || onOpenFeed) && (
        <div className={styles.footer}>
          {onOpenChatRooms && (
            <button className={styles.footerBtn} onClick={onOpenChatRooms}>
              {t('buddyList.footer.chatRooms')}
            </button>
          )}
          {onOpenFeed && (
            <button className={styles.footerBtn} onClick={onOpenFeed}>
              {t('buddyList.footer.feed')}
            </button>
          )}
        </div>
      )}
      {reportDid && (
        <ReportUserModal
          subjectDid={reportDid}
          onClose={() => {
            setReportDid(null);
          }}
        />
      )}
    </div>
  );
}

/** Isolated component so the 3s placeholder interval only re-renders this subtree. */
function AddBuddySearch({
  onSelect,
  buddyDids,
}: {
  onSelect: (actor: ActorSearchResult) => void;
  buddyDids: Set<string>;
}) {
  const placeholder = useRotatingPlaceholder('buddy');
  return (
    <ActorSearch
      id="add-buddy-search"
      onSelect={onSelect}
      isOptionDisabled={(actor) => buddyDids.has(actor.did)}
      placeholder={placeholder}
      variant="compact"
    />
  );
}
