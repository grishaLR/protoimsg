import { useState } from 'react';
import { Header } from '../components/layout/Header';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { useRooms } from '../hooks/useRooms';
import { useBuddyList } from '../hooks/useBuddyList';
import { useDm } from '../contexts/DmContext';
import { useBlocks } from '../contexts/BlockContext';
import styles from './RoomDirectoryPage.module.css';

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
  const { openDm } = useDm();
  const { blockedDids, toggleBlock } = useBlocks();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = search
    ? rooms.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rooms;

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.body}>
        <main className={styles.main}>
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
