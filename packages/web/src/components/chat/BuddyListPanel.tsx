import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualList } from 'virtualized-ui';
import type { CommunityGroup } from '@protoimsg/lexicon';
import { BOT } from '@protoimsg/shared';
import { BOT_ENABLED, IS_TAURI } from '../../lib/config';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { BuddyMenu } from './BuddyMenu';
import { ActorSearch, type ActorSearchResult } from '../shared/ActorSearch';
import { useRotatingPlaceholder } from '../../hooks/useRotatingPlaceholder';
import { useBlocks } from '../../contexts/BlockContext';
import { useBotDm } from '../../contexts/BotDmContext';
import { ReportUserModal } from '../feedback/ReportUserModal';
import type { FollowGraphEntry } from '../../hooks/useFollowGraph';
import type { DoorEvent } from '../../hooks/useBuddyList';
import type { MemberWithPresence, CommunityListRow } from '../../types';
import { Video } from 'lucide-react';
import styles from './BuddyListPanel.module.css';

// game-icons.net/1x1/skoll/chess-knight — CC BY 3.0, skoll
const CHESS_KNIGHT_PATH =
  'M60.81 476.91h300v-60h-300v60zm233.79-347.3 13.94 7.39c31.88-43.62 61.34-31.85 61.34-31.85l-21.62 53 35.64 19 2.87 33 64.42 108.75-43.55 29.37s-26.82-36.39-39.65-43.66c-10.66-6-41.22-10.25-56.17-12l-67.54-76.91-12 10.56 37.15 42.31c-.13.18-.25.37-.38.57-35.78 58.17 23 105.69 68.49 131.78H84.14C93 85 294.6 129.61 294.6 129.61z';

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
  onOpenMeet?: () => void;
  onOpenGames?: () => void;
  /** When true, force footer visible even at narrow widths (Tauri main window). */
  tauriMode?: boolean;
  followers?: FollowGraphEntry[];
  following?: FollowGraphEntry[];
  fetchMoreFollowers?: () => void;
  fetchMoreFollowing?: () => void;
  hasMoreFollowers?: boolean;
  hasMoreFollowing?: boolean;
}

const OFFLINE_GROUP = 'Offline';
const BLOCKED_GROUP = 'Blocked';
const MOOTS_GROUP = 'Moots';
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
  onOpenMeet,
  onOpenGames,
  tauriMode,
  error,
  followers = [],
  following = [],
  fetchMoreFollowers,
  fetchMoreFollowing,
  hasMoreFollowers,
  hasMoreFollowing,
}: BuddyListPanelProps) {
  const { t } = useTranslation('common');
  const { blockedDids } = useBlocks();
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set([MOOTS_GROUP, FOLLOWING_GROUP, FOLLOWERS_GROUP, OFFLINE_GROUP, BLOCKED_GROUP]),
  );
  const toggleCollapse = useCallback((name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const { openBotDm } = useBotDm();
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

  // Moots = mutual follows, excluding community + blocked
  const followerSet = useMemo(() => new Set(followers.map((f) => f.did)), [followers]);

  const mootsFiltered: MemberWithPresence[] = useMemo(
    () =>
      following
        .filter((f) => followerSet.has(f.did) && !buddyDids.has(f.did) && !blockedDids.has(f.did))
        .map((f) => ({ did: f.did, status: 'offline', addedAt: '' })),
    [following, followerSet, buddyDids, blockedDids],
  );

  const mootDids = useMemo(() => new Set(mootsFiltered.map((m) => m.did)), [mootsFiltered]);

  // Filter follow-graph entries: exclude community members, blocked users, and moots
  const followingFiltered: MemberWithPresence[] = useMemo(
    () =>
      following
        .filter((f) => !buddyDids.has(f.did) && !blockedDids.has(f.did) && !mootDids.has(f.did))
        .map((f) => ({ did: f.did, status: 'offline', addedAt: '' })),
    [following, buddyDids, blockedDids, mootDids],
  );

  const followersFiltered: MemberWithPresence[] = useMemo(
    () =>
      followers
        .filter((f) => !buddyDids.has(f.did) && !blockedDids.has(f.did) && !mootDids.has(f.did))
        .map((f) => ({ did: f.did, status: 'offline', addedAt: '' })),
    [followers, buddyDids, blockedDids, mootDids],
  );

  const isMootsCollapsed = collapsed.has(MOOTS_GROUP);
  const isFollowingCollapsed = collapsed.has(FOLLOWING_GROUP);
  const isFollowersCollapsed = collapsed.has(FOLLOWERS_GROUP);
  const isBlockedCollapsed = collapsed.has(BLOCKED_GROUP);

  const blockedFiltered: MemberWithPresence[] = useMemo(
    () =>
      [...blockedDids].map(
        (did) => presenceMap.get(did) ?? { did, status: 'offline', addedAt: '' },
      ),
    [blockedDids, presenceMap],
  );

  const hasAnyRows = rows.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.searchSection}>
        <label className={styles.searchLabel} htmlFor="add-buddy-search">
          {t('buddyList.addBuddyLabel')}
        </label>
        <AddBuddySearch onSelect={handleBuddySelect} buddyDids={buddyDids} />
      </div>

      {BOT_ENABLED && (
        <div
          className={styles.buddy}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (IS_TAURI) {
              void import('../../lib/tauri-windows').then(({ openBotWindow }) => {
                void openBotWindow();
              });
            } else {
              openBotDm();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (IS_TAURI) {
                void import('../../lib/tauri-windows').then(({ openBotWindow }) => {
                  void openBotWindow();
                });
              } else {
                openBotDm();
              }
            }
          }}
          style={{ paddingInlineStart: 'var(--cm-space-2)', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 'var(--cm-text-base)', lineHeight: 1, flexShrink: 0 }}>
            {'\u{1F916}'}
          </span>
          <div className={styles.buddyInfo}>
            <span className={styles.buddyDid}>{BOT.displayName}</span>
          </div>
          <StatusIndicator status="online" />
        </div>
      )}

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
                const isSynthetic = row.groupName === OFFLINE_GROUP;
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
                      <InlineGroupHeader
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
              const awayTooltip = hasAwayMessage ? buddy.awayMessage : undefined;

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

      {/* Moots group */}
      {mootsFiltered.length > 0 && (
        <>
          <InlineGroupHeader
            groupName={MOOTS_GROUP}
            onlineCount={0}
            totalCount={mootsFiltered.length}
            isCollapsed={isMootsCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(MOOTS_GROUP);
            }}
          />
          {!isMootsCollapsed && (
            <div className={styles.list}>
              {mootsFiltered.map((buddy) => (
                <div key={buddy.did} className={`${styles.buddy} ${styles.buddyIndented}`}>
                  <StatusIndicator status={buddy.status} />
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
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Following group */}
      {followingFiltered.length > 0 && (
        <>
          <InlineGroupHeader
            groupName={FOLLOWING_GROUP}
            onlineCount={0}
            totalCount={followingFiltered.length + (hasMoreFollowing ? 1 : 0)}
            isCollapsed={isFollowingCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(FOLLOWING_GROUP);
            }}
          />
          {!isFollowingCollapsed && (
            <div className={styles.list}>
              {followingFiltered.map((buddy) => (
                <div key={buddy.did} className={`${styles.buddy} ${styles.buddyIndented}`}>
                  <StatusIndicator status={buddy.status} />
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
                </div>
              ))}
              {hasMoreFollowing && fetchMoreFollowing && (
                <button className={styles.footerBtn} onClick={fetchMoreFollowing}>
                  {t('buddyList.loadMore', 'Load more')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Followers group */}
      {followersFiltered.length > 0 && (
        <>
          <InlineGroupHeader
            groupName={FOLLOWERS_GROUP}
            onlineCount={0}
            totalCount={followersFiltered.length + (hasMoreFollowers ? 1 : 0)}
            isCollapsed={isFollowersCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(FOLLOWERS_GROUP);
            }}
          />
          {!isFollowersCollapsed && (
            <div className={styles.list}>
              {followersFiltered.map((buddy) => (
                <div key={buddy.did} className={`${styles.buddy} ${styles.buddyIndented}`}>
                  <StatusIndicator status={buddy.status} />
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
                </div>
              ))}
              {hasMoreFollowers && fetchMoreFollowers && (
                <button className={styles.footerBtn} onClick={fetchMoreFollowers}>
                  {t('buddyList.loadMore', 'Load more')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Blocked group */}
      {blockedFiltered.length > 0 && (
        <>
          <InlineGroupHeader
            groupName={BLOCKED_GROUP}
            onlineCount={0}
            totalCount={blockedFiltered.length}
            isCollapsed={isBlockedCollapsed}
            onToggleCollapse={() => {
              toggleCollapse(BLOCKED_GROUP);
            }}
          />
          {!isBlockedCollapsed && (
            <div className={styles.list}>
              {blockedFiltered.map((buddy) => (
                <div key={buddy.did} className={`${styles.buddy} ${styles.buddyIndented}`}>
                  <StatusIndicator status={buddy.status} />
                  <div className={styles.buddyInfo}>
                    <span className={styles.buddyDid}>
                      <UserIdentity did={buddy.did} showAvatar />
                    </span>
                  </div>
                  <BuddyMenu
                    buddy={buddy}
                    groupName={BLOCKED_GROUP}
                    allGroups={groups}
                    isBlocked={true}
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
              ))}
            </div>
          )}
        </>
      )}

      {/* Create group UI — hidden until feature is ready */}

      {(onOpenMeet ?? onOpenGames) && (
        <div className={`${styles.footer}${tauriMode ? ` ${styles.tauriFooter}` : ''}`}>
          {onOpenMeet && (
            <button className={styles.footerBtn} onClick={onOpenMeet}>
              <Video size={13} />
              {t('buddyList.footer.meet', 'Video Chat')}
            </button>
          )}
          {onOpenGames && (
            <button className={styles.footerBtn} onClick={onOpenGames}>
              <span className={styles.footerBtnIcon}>
                <svg width={13} height={13} viewBox="40 75 430 415" fill="currentColor">
                  <path d={CHESS_KNIGHT_PATH} />
                </svg>
              </span>
              <span>Fun</span>
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

/** Inline replacement for the deleted GroupHeaderRow component. */
function InlineGroupHeader({
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
  isProtected?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={styles.groupHeader}
      onClick={onToggleCollapse}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onToggleCollapse();
      }}
    >
      <span className={styles.groupName}>
        {isCollapsed ? '\u25B6' : '\u25BC'} {groupName} ({onlineCount}/{totalCount})
      </span>
      {!isProtected && (
        <span className={styles.groupHeaderActions}>
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              aria-label="Rename group"
            >
              &#9998;
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete group"
            >
              &times;
            </button>
          )}
        </span>
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
