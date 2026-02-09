import { useState, useCallback } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { Header } from '../components/layout/Header';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { FeedView } from '../components/feed/FeedView';
import { ProfileView } from '../components/feed/ProfileView';
import { ThreadView } from '../components/feed/ThreadView';
import { SettingsView } from '../components/settings/SettingsView';
import { useRooms } from '../hooks/useRooms';
import { useBuddyList } from '../hooks/useBuddyList';
import { useDm } from '../contexts/DmContext';
import { useBlocks } from '../contexts/BlockContext';
import styles from './RoomDirectoryPage.module.css';

type View = 'rooms' | 'feed' | 'profile' | 'thread' | 'settings';

export function RoomDirectoryPage() {
  const { rooms, loading, error, refresh } = useRooms();
  const {
    buddies,
    groups,
    doorEvents,
    loading: buddiesLoading,
    addBuddy,
    removeBuddy,
    toggleCloseFriend,
    blockBuddy,
    agent,
    createGroup,
    renameGroup,
    deleteGroup,
    moveBuddy,
  } = useBuddyList();
  const { openDm, openDmMinimized } = useDm();
  const { blockedDids, toggleBlock } = useBlocks();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<View>('rooms');
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [threadStack, setThreadStack] = useState<string[]>([]);
  const [prevView, setPrevView] = useState<'rooms' | 'feed'>('feed');
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

  const showTabs = view === 'rooms' || view === 'feed';

  return (
    <div className={styles.page}>
      <Header onOpenSettings={navigateToSettings} onOpenProfile={navigateToProfile} />
      <div className={styles.body}>
        <main className={styles.main}>
          {showTabs && (
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewTab} ${view === 'rooms' ? styles.viewTabActive : ''}`}
                onClick={() => {
                  setView('rooms');
                }}
              >
                Rooms
              </button>
              <button
                className={`${styles.viewTab} ${view === 'feed' ? styles.viewTabActive : ''}`}
                onClick={() => {
                  setView('feed');
                }}
              >
                Feed
              </button>
            </div>
          )}

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
        <aside className={styles.sidebar}>
          <BuddyListPanel
            buddies={buddies}
            groups={groups}
            doorEvents={doorEvents}
            loading={buddiesLoading}
            agent={agent}
            onAddBuddy={addBuddy}
            onRemoveBuddy={removeBuddy}
            onToggleCloseFriend={toggleCloseFriend}
            onBlockBuddy={(did: string) => {
              const isCurrentlyBlocked = blockedDids.has(did);
              toggleBlock(did); // immediate server sync
              blockBuddy(did, isCurrentlyBlocked).catch(() => {
                toggleBlock(did); // rollback on ATProto failure
              });
            }}
            onSendIm={openDm}
            onBuddyClick={(did: string) => {
              navigateToProfile(did);
              openDmMinimized(did); // always opens DM minimized
            }}
            onCreateGroup={createGroup}
            onRenameGroup={renameGroup}
            onDeleteGroup={deleteGroup}
            onMoveBuddy={moveBuddy}
          />
        </aside>
      </div>
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
