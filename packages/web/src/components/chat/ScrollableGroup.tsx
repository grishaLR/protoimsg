import { useRef, useCallback } from 'react';
import type { MemberWithPresence } from '../../types';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { BuddyMenu } from './BuddyMenu';
import type { CommunityGroup } from '@protoimsg/lexicon';
import buddyStyles from './BuddyListPanel.module.css';
import styles from './ScrollableGroup.module.css';

interface ScrollableGroupProps {
  items: MemberWithPresence[];
  groupName: string;
  allGroups: CommunityGroup[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  onBuddyClick?: (did: string) => void;
  onAddToCommunity?: (did: string) => void;
  onBlock?: (did: string) => void;
  onReport?: (did: string) => void;
  blockedDids: Set<string>;
}

const SCROLL_THRESHOLD = 50;

export function ScrollableGroup({
  items,
  groupName,
  allGroups,
  onLoadMore,
  hasMore,
  onBuddyClick,
  onAddToCommunity,
  onBlock,
  onReport,
  blockedDids,
}: ScrollableGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!onLoadMore || !hasMore) return;
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore]);

  return (
    <div className={styles.container} ref={containerRef} onScroll={handleScroll}>
      {items.map((buddy) => (
        <div key={buddy.did} className={`${buddyStyles.buddy} ${buddyStyles.buddyIndented}`}>
          <StatusIndicator status={buddy.status} />
          <div className={buddyStyles.buddyInfo}>
            <span
              className={buddyStyles.buddyDid}
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
            groupName={groupName}
            allGroups={allGroups}
            isBlocked={blockedDids.has(buddy.did)}
            onRemove={() => {}}
            onToggleInnerCircle={() => {}}
            onBlock={() => {
              onBlock?.(buddy.did);
            }}
            onMoveBuddy={() => {}}
            onAddToCommunity={
              onAddToCommunity
                ? () => {
                    onAddToCommunity(buddy.did);
                  }
                : undefined
            }
            onReport={
              onReport
                ? () => {
                    onReport(buddy.did);
                  }
                : undefined
            }
            isFollowGraphEntry
          />
        </div>
      ))}
    </div>
  );
}
