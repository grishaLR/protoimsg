import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
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
import { GAMES_ENABLED, IS_TAURI, TOWN_ENABLED } from '../lib/config';

// Lazy — the town pulls in pixi.js (~hundreds of KB); non-town users skip it.
const ProtoTownPanel = lazy(() =>
  import('../components/prototown/ProtoTownPanel').then((m) => ({ default: m.ProtoTownPanel })),
);

// Lazy — keeps the games chunk out of the main HomePage bundle.
const GamesPanel = lazy(() =>
  import('../components/games/GamesPanel').then((m) => ({ default: m.GamesPanel })),
);
import styles from './HomePage.module.css';

type View = 'meet' | 'buddies' | 'settings' | 'games' | 'town';

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
      if (GAMES_ENABLED) return 'games';
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
      void setTrayCallState(inCall, TOWN_ENABLED);
    });
  }, [buddies, activeCall, activeGroupCall]);

  // Desktop (Tauri): town lives in the main window, not a child window, so it
  // shares the real WebSocket and presence state with the buddy list. The
  // window grows to fit town + buddy sidebar before town mounts.
  // Each open gets a token; anything that moves you elsewhere mid-grow (another
  // view, hiding to tray) bumps it, so a stale open never lands you in town.
  const townOpenTokenRef = useRef(0);
  const openTown = useCallback(() => {
    if (!TOWN_ENABLED) return;
    if (IS_TAURI) {
      const token = ++townOpenTokenRef.current;
      void import('../lib/tauri-windows').then(
        async ({ expandMainWindowForTown, restoreMainWindowFromTown }) => {
          await expandMainWindowForTown();
          if (token === townOpenTokenRef.current) setView('town');
          else await restoreMainWindowFromTown();
        },
      );
      return;
    }
    setView('town');
  }, []);

  const handleLeaveTown = useCallback(() => {
    setView('buddies');
  }, []);

  const handleOpenMeet = useCallback(() => {
    if (IS_TAURI) {
      void import('../lib/tauri-windows').then(({ openMeetWindow }) => {
        void openMeetWindow();
      });
      return;
    }
    setView('meet');
  }, []);

  // Tauri: shrink back to the buddy-list size whenever we're not in town, and
  // cancel any town open still waiting on the window to grow.
  useEffect(() => {
    if (!IS_TAURI || view === 'town') return;
    townOpenTokenRef.current++;
    void import('../lib/tauri-windows').then(({ restoreMainWindowFromTown }) => {
      void restoreMainWindowFromTown();
    });
  }, [view]);

  // Tauri: tray "Start Meet" / "Open proto town" → open them. Hiding to tray → leave town, so
  // you aren't standing in town (mic live) behind a hidden window.
  useEffect(() => {
    if (!IS_TAURI) return;
    let aborted = false;
    const unlisteners: (() => void)[] = [];
    const register = (pending: Promise<() => void>): void => {
      pending
        .then((fn) => {
          if (aborted) fn();
          else unlisteners.push(fn);
        })
        .catch((err: unknown) => {
          console.error('HomePage: failed to register Tauri listener:', err);
        });
    };
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (aborted) return;
      register(
        listen('app://open-town', () => {
          openTown();
        }),
      );
      register(
        listen('app://open-meet', () => {
          handleOpenMeet();
        }),
      );
      register(
        listen('app://window-hiding', () => {
          townOpenTokenRef.current++;
          setView((v) => (v === 'town' ? 'buddies' : v));
        }),
      );
    });
    return () => {
      aborted = true;
      for (const fn of unlisteners) fn();
    };
  }, [openTown, handleOpenMeet]);

  const handleTabChange = useCallback(
    (tab: MobileTab) => {
      if (tab === 'fun' && !GAMES_ENABLED) return;
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
      if (tab === 'town') {
        openTown();
        return;
      }
      if (tab === 'meet' || tab === 'buddies' || tab === 'fun') {
        setView(tab === 'fun' ? 'games' : tab);
      }
    },
    [openTown],
  );

  const handleOpenSettings = useCallback(() => {
    setView('settings');
  }, []);

  const handleOpenGames = useCallback(() => {
    if (!GAMES_ENABLED) return;
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
      onBack={IS_TAURI && view === 'town' ? handleLeaveTown : undefined}
      onOpenMeet={view !== 'meet' ? handleOpenMeet : undefined}
      onOpenGames={GAMES_ENABLED && view !== 'games' ? handleOpenGames : undefined}
      onOpenTown={TOWN_ENABLED && view !== 'town' ? openTown : undefined}
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
              <Suspense fallback={null}>
                <GamesPanel />
              </Suspense>
            </div>
          ) : view === 'town' ? (
            <div className={styles.main}>
              <Suspense fallback={null}>
                <ProtoTownPanel />
              </Suspense>
            </div>
          ) : (
            <div className={styles.main}>
              <MeetLanding />
            </div>
          )}
        </div>
        <MobileTabBar
          activeTab={
            view === 'buddies'
              ? 'buddies'
              : view === 'games'
                ? 'fun'
                : view === 'town'
                  ? 'town'
                  : 'meet'
          }
          onTabChange={handleTabChange}
        />
      </div>
    );
  }

  // Desktop: meet center + buddy sidebar.
  // Keep page > body > div.main > Suspense at the same position as the mobile
  // branch: on Tauri the window grows from mobile to desktop width while in
  // town, and a tree change here would remount ProtoTownPanel (leave + rejoin).
  return (
    <div className={styles.page}>
      <Header onOpenSettings={handleOpenSettings} />
      <div className={styles.body}>
        <div className={styles.main}>
          {profilePanel ??
            (view === 'games' ? (
              <Suspense fallback={null}>
                <GamesPanel />
              </Suspense>
            ) : view === 'town' ? (
              <Suspense fallback={null}>
                <ProtoTownPanel />
              </Suspense>
            ) : (
              <MeetLanding />
            ))}
        </div>
        <aside className={styles.sidebar}>{buddyPanel}</aside>
      </div>
    </div>
  );
}
