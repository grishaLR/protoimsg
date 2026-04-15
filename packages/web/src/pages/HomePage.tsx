import { useState, useCallback, useEffect, useMemo } from 'react';
import { Header } from '../components/layout/Header';
import { MobileTabBar } from '../components/layout/MobileTabBar';
import type { MobileTab } from '../components/layout/MobileTabBar';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { SettingsView } from '../components/settings/SettingsView';
import { useBuddyList } from '../hooks/useBuddyList';
import { useFollowGraph } from '../hooks/useFollowGraph';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDm } from '../contexts/DmContext';
import { useVideoCall, setInnerCircleDidsForCalls } from '../contexts/VideoCallContext';
import { useBlocks } from '../contexts/BlockContext';
import { MeetLanding } from './MeetPage';
import { IS_TAURI } from '../lib/config';
import styles from './HomePage.module.css';

type View = 'meet' | 'buddies' | 'settings';

export function HomePage() {
  const {
    buddies,
    groups,
    doorEvents,
    loading: buddiesLoading,
    error: buddiesError,
    addBuddy,
    removeBuddy,
    toggleInnerCircle,
    blockBuddy,
    innerCircleDids,
    createGroup,
    renameGroup,
    deleteGroup,
    moveBuddy,
  } = useBuddyList();
  const {
    followers,
    following,
    fetchMoreFollowers,
    fetchMoreFollowing,
    hasMoreFollowers,
    hasMoreFollowing,
  } = useFollowGraph();

  useEffect(() => {
    setInnerCircleDidsForCalls(innerCircleDids);
  }, [innerCircleDids]);

  const { openDm, openDmMinimized, conversations, notifications } = useDm();

  const imUnreadMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations) {
      if (c.unreadCount > 0) map.set(c.recipientDid, c.unreadCount);
    }
    return map;
  }, [conversations]);

  const imNotifySet = useMemo(() => {
    const set = new Set<string>();
    for (const n of notifications) {
      set.add(n.senderDid);
    }
    return set;
  }, [notifications]);

  const { videoCall, activeCall } = useVideoCall();
  const { blockedDids, toggleBlock } = useBlocks();
  const isMobile = useIsMobile();

  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 767px)').matches ? 'buddies' : 'meet',
  );

  // Tauri: update system tray tooltip
  useEffect(() => {
    if (!IS_TAURI) return;
    const onlineCount = buddies.filter((b) => b.status !== 'offline').length;
    void import('../lib/tauri-tray').then(({ updateTrayTooltip }) => {
      void updateTrayTooltip(onlineCount, 'online', 0, activeCall != null);
    });
  }, [buddies, activeCall]);

  const handleTabChange = useCallback((tab: MobileTab) => {
    if (tab === 'meet' || tab === 'buddies') {
      setView(tab);
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    setView('settings');
  }, []);

  if (view === 'settings') {
    return (
      <div className={styles.page}>
        <Header onOpenSettings={handleOpenSettings} />
        <div className={styles.body}>
          <SettingsView
            onBack={() => {
              setView('meet');
            }}
          />
        </div>
      </div>
    );
  }

  const buddyPanel = (
    <BuddyListPanel
      buddies={buddies}
      groups={groups}
      doorEvents={doorEvents}
      loading={buddiesLoading}
      error={buddiesError}
      onAddBuddy={addBuddy}
      onRemoveBuddy={removeBuddy}
      onToggleInnerCircle={toggleInnerCircle}
      onBlockBuddy={(targetDid: string) => {
        const isCurrentlyBlocked = blockedDids.has(targetDid);
        toggleBlock(targetDid);
        void blockBuddy(targetDid, isCurrentlyBlocked);
      }}
      onSendIm={IS_TAURI ? openDmMinimized : openDm}
      onVideoCall={(targetDid) => {
        videoCall(targetDid);
      }}
      imUnreadMap={imUnreadMap}
      imNotifySet={imNotifySet}
      followers={followers}
      following={following}
      fetchMoreFollowers={() => {
        void fetchMoreFollowers();
      }}
      fetchMoreFollowing={() => {
        void fetchMoreFollowing();
      }}
      hasMoreFollowers={hasMoreFollowers}
      hasMoreFollowing={hasMoreFollowing}
      onCreateGroup={createGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={deleteGroup}
      onMoveBuddy={moveBuddy}
    />
  );

  // Mobile: show one view at a time
  if (isMobile) {
    return (
      <div className={styles.page}>
        <Header onOpenSettings={handleOpenSettings} />
        <div className={styles.body}>
          {view === 'buddies' ? (
            <div className={styles.main}>{buddyPanel}</div>
          ) : (
            <div className={styles.main}>
              <MeetLanding />
            </div>
          )}
        </div>
        <MobileTabBar
          activeTab={view === 'buddies' ? 'buddies' : 'meet'}
          onTabChange={handleTabChange}
        />
      </div>
    );
  }

  // Desktop: meet center + buddy sidebar
  return (
    <div className={styles.page}>
      <Header onOpenSettings={handleOpenSettings} />
      <div className={styles.body}>
        <div className={styles.main}>
          <MeetLanding />
        </div>
        <aside className={styles.sidebar}>{buddyPanel}</aside>
      </div>
    </div>
  );
}
