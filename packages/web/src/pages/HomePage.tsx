import { useState, useCallback, useEffect, useMemo } from 'react';
import { Header } from '../components/layout/Header';
import { MobileTabBar } from '../components/layout/MobileTabBar';
import type { MobileTab } from '../components/layout/MobileTabBar';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { ProfileView } from '../components/chat/ProfileView';
import { SettingsView } from '../components/settings/SettingsView';
import { useBuddyList } from '../hooks/useBuddyList';
import { useFollowGraph } from '../hooks/useFollowGraph';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDm } from '../contexts/DmContext';
import { useVideoCall, setInnerCircleDidsForCalls } from '../contexts/VideoCallContext';
import { useGroupCall } from '../contexts/GroupCallContext';
import { useBlocks } from '../contexts/BlockContext';
import { MeetLanding } from './MeetPage';
import { GamesPanel } from '../components/games/GamesPanel';
import { IS_TAURI } from '../lib/config';
import styles from './HomePage.module.css';

type View = 'meet' | 'buddies' | 'settings' | 'games';

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

  const { openDm, conversations, notifications } = useDm();

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
  const { activeGroupCall } = useGroupCall();
  const { blockedDids, toggleBlock } = useBlocks();
  const isMobile = useIsMobile();

  const [view, setView] = useState<View>(() => {
    if (sessionStorage.getItem('protoimsg:pending_games') === '1') {
      sessionStorage.removeItem('protoimsg:pending_games');
      return 'games';
    }
    return window.matchMedia('(max-width: 767px)').matches ? 'buddies' : 'meet';
  });
  const [profileDid, setProfileDid] = useState<string | null>(null);
  const handleBuddyClick = useCallback((did: string) => {
    if (IS_TAURI) {
      void import('../lib/tauri-windows').then(({ openProfileWindow }) => {
        void openProfileWindow(did);
      });
      return;
    }
    setProfileDid(did);
  }, []);
  const handleCloseProfile = useCallback(() => {
    setProfileDid(null);
  }, []);

  // Tauri: update system tray tooltip and call-state menu
  useEffect(() => {
    if (!IS_TAURI) return;
    const onlineCount = buddies.filter((b) => b.status !== 'offline').length;
    const inCall = activeCall != null || activeGroupCall != null;
    void import('../lib/tauri-tray').then(({ updateTrayTooltip, setTrayCallState }) => {
      void updateTrayTooltip(onlineCount, 'online', 0, inCall);
      void setTrayCallState(inCall);
    });
  }, [buddies, activeCall, activeGroupCall]);

  const handleTabChange = useCallback((tab: MobileTab) => {
    if (IS_TAURI && tab === 'fun') {
      void import('../lib/tauri-windows').then(({ openGamesWindow }) => {
        void openGamesWindow();
      });
      return;
    }
    if (IS_TAURI && tab === 'meet') {
      void import('../lib/tauri-windows').then(({ openMeetWindow }) => {
        void openMeetWindow();
      });
      return;
    }
    if (tab === 'meet' || tab === 'buddies' || tab === 'fun') {
      setView(tab === 'fun' ? 'games' : tab);
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    setView('settings');
  }, []);

  const handleOpenGames = useCallback(() => {
    if (IS_TAURI) {
      void import('../lib/tauri-windows').then(({ openGamesWindow }) => {
        void openGamesWindow();
      });
      return;
    }
    setView('games');
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
      onSendIm={openDm}
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
      onBuddyClick={handleBuddyClick}
      onOpenMeet={
        view === 'games'
          ? () => {
              setView('meet');
            }
          : undefined
      }
      onOpenGames={view !== 'games' ? handleOpenGames : undefined}
    />
  );

  const profilePanel = profileDid ? (
    <ProfileView actor={profileDid} onBack={handleCloseProfile} />
  ) : null;

  // Mobile: show one view at a time
  if (isMobile) {
    return (
      <div className={styles.page}>
        <Header onOpenSettings={handleOpenSettings} />
        <div className={styles.body}>
          {view === 'buddies' ? (
            <div className={styles.main}>{profilePanel ?? buddyPanel}</div>
          ) : view === 'games' ? (
            <div className={styles.main}>
              <GamesPanel />
            </div>
          ) : (
            <div className={styles.main}>
              <MeetLanding />
            </div>
          )}
        </div>
        <MobileTabBar
          activeTab={view === 'buddies' ? 'buddies' : view === 'games' ? 'fun' : 'meet'}
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
          {profilePanel ?? (view === 'games' ? <GamesPanel /> : <MeetLanding />)}
        </div>
        <aside className={styles.sidebar}>{buddyPanel}</aside>
      </div>
    </div>
  );
}
