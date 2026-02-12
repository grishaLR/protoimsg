import { useState, useCallback } from 'react';
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
import { useIsMobile } from '../hooks/useIsMobile';
import { useDm } from '../contexts/DmContext';
import { useBlocks } from '../contexts/BlockContext';
import { IS_TAURI } from '../lib/config';
import styles from './RoomDirectoryPage.module.css';

type View = 'rooms' | 'feed' | 'buddies' | 'profile' | 'thread' | 'settings';

export function RoomDirectoryPage() {
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
    createGroup,
    renameGroup,
    deleteGroup,
    moveBuddy,
  } = useBuddyList();
  const { openDm, openDmMinimized } = useDm();
  const { blockedDids, toggleBlock } = useBlocks();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 767px)').matches ? 'buddies' : 'rooms',
  );
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [threadStack, setThreadStack] = useState<string[]>([]);
  const [prevView, setPrevView] = useState<'rooms' | 'feed' | 'buddies'>('feed');
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  const threadUri = threadStack.length > 0 ? (threadStack[threadStack.length - 1] ?? null) : null;

  const navigateToProfile = useCallback(
    (did: string) => {
      setPrevView(view === 'profile' || view === 'thread' || view === 'settings' ? prevView : view);
      setProfileTarget(did);
      setView('profile');
    },
    [view, prevView],
  );

  const backFromProfile = useCallback(() => {
    setView(prevView);
    setProfileTarget(null);
  }, [prevView]);

  const openThread = useCallback(
    (post: AppBskyFeedDefs.PostView) => {
      if (view === 'thread') {
        // Drilling into a reply — push onto stack
        setThreadStack((prev) => [...prev, post.uri]);
      } else {
        // Entering thread from feed/profile
        setPrevView(view === 'profile' || view === 'settings' ? prevView : view);
        setThreadStack([post.uri]);
        setView('thread');
      }
    },
    [view, prevView],
  );

  const backFromThread = useCallback(() => {
    if (threadStack.length > 1) {
      // Pop back to parent thread
      setThreadStack((prev) => prev.slice(0, -1));
    } else {
      // Back to previous view
      setView(prevView);
      setThreadStack([]);
    }
  }, [prevView, threadStack.length]);

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
    setView('feed');
  }, []);

  const clearReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const navigateToSettings = useCallback(() => {
    setPrevView(view === 'profile' || view === 'thread' || view === 'settings' ? prevView : view);
    setView('settings');
  }, [view, prevView]);

  const backFromSettings = useCallback(() => {
    setView(prevView);
  }, [prevView]);

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
    onSendIm: openDm,
    onBuddyClick: (did: string) => {
      navigateToProfile(did);
      openDmMinimized(did);
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
              onBack={backFromProfile}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
            />
          ) : view === 'settings' ? (
            <SettingsView onBack={backFromSettings} />
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
                  placeholder="Search rooms..."
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
                  Create Room
                </button>
              </div>
              {error && <p className={styles.error}>{error}</p>}
              {loading ? <p>Loading rooms...</p> : <RoomList rooms={filtered} />}
            </>
          )}

          {view === 'feed' && (
            <FeedView
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
              replyTo={replyTo}
              onClearReply={clearReply}
            />
          )}

          {view === 'profile' && profileTarget && (
            <ProfileView
              actor={profileTarget}
              onBack={backFromProfile}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
            />
          )}

          {view === 'thread' && threadUri && (
            <ThreadView
              uri={threadUri}
              onBack={backFromThread}
              onNavigateToProfile={navigateToProfile}
              onReply={handleReply}
              onOpenThread={openThread}
            />
          )}

          {view === 'settings' && <SettingsView onBack={backFromSettings} />}
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
