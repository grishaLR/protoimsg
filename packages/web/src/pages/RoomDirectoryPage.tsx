import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import { Header } from '../components/layout/Header';
import { MobileTabBar } from '../components/layout/MobileTabBar';
import type { MobileTab } from '../components/layout/MobileTabBar';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { FeedView } from '../components/feed/FeedView';
import { ProfileView } from '../components/feed/ProfileView';
import { ThreadView } from '../components/feed/ThreadView';
import { SettingsView } from '../components/settings/SettingsView';
import { useRooms } from '../hooks/useRooms';
import { useBuddyList } from '../hooks/useBuddyList';
import { useFollowGraph } from '../hooks/useFollowGraph';
import { useIsMobile } from '../hooks/useIsMobile';
import { LoadingBars } from '../components/LoadingBars';
import { useDm } from '../contexts/DmContext';
import { useVideoCall, setInnerCircleDidsForCalls } from '../contexts/VideoCallContext';
import { useBlocks } from '../contexts/BlockContext';
import { IS_TAURI } from '../lib/config';
import styles from './RoomDirectoryPage.module.css';

type View = 'rooms' | 'feed' | 'buddies' | 'profile' | 'thread' | 'settings';

export function RoomDirectoryPage() {
  const { t } = useTranslation('rooms');
  const location = useLocation();
  const { rooms, loading, error, refresh } = useRooms();
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
  // Sync inner-circle DIDs to VideoCallContext for IP protection decisions
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
  const { videoCall } = useVideoCall();
  const { blockedDids, toggleBlock } = useBlocks();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const locState = location.state as { tab?: View } | null;
  const [view, setView] = useState<View>(() => {
    if (locState?.tab) return locState.tab;
    return window.matchMedia('(max-width: 767px)').matches ? 'buddies' : 'rooms';
  });

  // When navigating back with state (e.g., from a chat room), switch to the requested tab
  useEffect(() => {
    if (locState?.tab) setView(locState.tab);
  }, [locState?.tab]);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);
  const [quoteTo, setQuoteTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  // Unified navigation history — each entry is the view + its payload
  type NavEntry =
    | { type: 'rooms' }
    | { type: 'feed' }
    | { type: 'buddies' }
    | { type: 'profile'; did: string }
    | { type: 'thread'; uri: string }
    | { type: 'settings' };
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);

  // Derive current thread/profile targets from the active view
  const threadUri =
    view === 'thread'
      ? ((navHistory[navHistory.length - 1] as { uri: string } | undefined)?.uri ?? null)
      : null;
  const profileTarget =
    view === 'profile'
      ? ((navHistory[navHistory.length - 1] as { did: string } | undefined)?.did ?? null)
      : null;

  const goBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length <= 1) {
        const root = prev[0];
        setView(root ? (root.type as View) : 'feed');
        return [];
      }
      const next = prev.slice(0, -1);
      const target = next[next.length - 1];
      if (target) setView(target.type as View);
      return next;
    });
  }, []);

  const navigateToProfile = useCallback(
    (did: string) => {
      setNavHistory((prev) => {
        // If navigating from a root view, seed the history with it
        if (view !== 'profile' && view !== 'thread' && view !== 'settings') {
          return [{ type: view }, { type: 'profile', did }];
        }
        return [...prev, { type: 'profile', did }];
      });
      setView('profile');
    },
    [view],
  );

  const openThread = useCallback(
    (post: AppBskyFeedDefs.PostView) => {
      setNavHistory((prev) => {
        if (view !== 'profile' && view !== 'thread' && view !== 'settings') {
          return [{ type: view }, { type: 'thread', uri: post.uri }];
        }
        return [...prev, { type: 'thread', uri: post.uri }];
      });
      setView('thread');
    },
    [view],
  );

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
    setView('feed');
  }, []);

  const clearReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handleQuotePost = useCallback((post: AppBskyFeedDefs.PostView) => {
    setQuoteTo(post);
    setView('feed');
  }, []);

  const clearQuote = useCallback(() => {
    setQuoteTo(null);
  }, []);

  const navigateToSettings = useCallback(() => {
    setNavHistory((prev) => {
      if (view !== 'profile' && view !== 'thread' && view !== 'settings') {
        return [{ type: view }, { type: 'settings' }];
      }
      return [...prev, { type: 'settings' }];
    });
    setView('settings');
  }, [view]);

  const filtered = search
    ? rooms.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rooms;

  const openTauriRoomDirectory = () => {
    void import('../lib/tauri-windows').then(({ openRoomDirectoryWindow }) => {
      void openRoomDirectoryWindow();
    });
  };

  const openTauriFeed = () => {
    void import('../lib/tauri-windows').then(({ openFeedWindow }) => {
      void openFeedWindow();
    });
  };

  const buddyListProps = {
    buddies,
    groups,
    doorEvents,
    loading: buddiesLoading,
    error: buddiesError,
    onAddBuddy: addBuddy,
    onRemoveBuddy: removeBuddy,
    onToggleInnerCircle: toggleInnerCircle,
    onBlockBuddy: (did: string) => {
      const isCurrentlyBlocked = blockedDids.has(did);
      toggleBlock(did);
      blockBuddy(did, isCurrentlyBlocked).catch(() => {
        toggleBlock(did);
      });
    },
    imUnreadMap,
    imNotifySet,
    onSendIm: openDm,
    onVideoCall: videoCall,
    onBuddyClick: (did: string) => {
      navigateToProfile(did);
      const buddy = buddies.find((b) => b.did === did);
      if (buddy && buddy.status !== 'offline') openDmMinimized(did);
    },
    onCreateGroup: createGroup,
    onRenameGroup: renameGroup,
    onDeleteGroup: deleteGroup,
    onMoveBuddy: moveBuddy,
    onOpenChatRooms: IS_TAURI
      ? openTauriRoomDirectory
      : () => {
          setView('rooms');
        },
    onOpenFeed: IS_TAURI
      ? openTauriFeed
      : () => {
          setView('feed');
        },
    followers,
    following,
    fetchMoreFollowers,
    fetchMoreFollowing,
    hasMoreFollowers,
    hasMoreFollowing,
  };

  const mobileTab: MobileTab = view === 'buddies' ? 'buddies' : view === 'rooms' ? 'rooms' : 'feed';

  const handleMobileTabChange = (tab: MobileTab) => {
    setView(tab);
  };

  // Tauri main window: buddy list is the entire window with action buttons at top
  if (IS_TAURI) {
    return (
      <div className={styles.page}>
        <Header onOpenSettings={navigateToSettings} />
        <div className={styles.tauriBody}>
          {view === 'profile' && profileTarget ? (
            <ProfileView
              actor={profileTarget}
              onBack={goBack}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
            />
          ) : view === 'settings' ? (
            <SettingsView onBack={goBack} />
          ) : (
            <BuddyListPanel {...buddyListProps} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header onOpenSettings={navigateToSettings} />
      <div className={styles.body}>
        <main className={styles.main}>
          {view === 'buddies' && isMobile && <BuddyListPanel {...buddyListProps} />}

          {view === 'rooms' && (
            <>
              <div className={styles.toolbar}>
                <input
                  className={styles.search}
                  type="text"
                  placeholder={t('directory.searchPlaceholder')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                />
                <button
                  className={styles.createButton}
                  onClick={() => {
                    setShowCreate(true);
                  }}
                >
                  {t('directory.createButton')}
                </button>
              </div>
              {error && <p className={styles.error}>{error}</p>}
              {loading ? (
                <div className={styles.loadingBody}>
                  <LoadingBars />
                </div>
              ) : (
                <RoomList rooms={filtered} />
              )}
            </>
          )}

          {view === 'feed' && (
            <FeedView
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
              onQuotePost={handleQuotePost}
              replyTo={replyTo}
              quoteTo={quoteTo}
              onClearReply={clearReply}
              onClearQuote={clearQuote}
            />
          )}

          {view === 'profile' && profileTarget && (
            <ProfileView
              actor={profileTarget}
              onBack={goBack}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
              onQuotePost={handleQuotePost}
            />
          )}

          {view === 'thread' && threadUri && (
            <ThreadView
              uri={threadUri}
              onBack={goBack}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
              onQuotePost={handleQuotePost}
            />
          )}

          {view === 'settings' && <SettingsView onBack={goBack} />}
        </main>
        {!isMobile && (
          <aside className={styles.sidebar}>
            <BuddyListPanel {...buddyListProps} />
          </aside>
        )}
      </div>
      {isMobile && <MobileTabBar activeTab={mobileTab} onTabChange={handleMobileTabChange} />}
      {showCreate && (
        <CreateRoomModal
          onClose={() => {
            setShowCreate(false);
          }}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
