import { useState } from 'react';
import { Header } from '../components/layout/Header';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { BuddyListPanel } from '../components/chat/BuddyListPanel';
import { useRooms } from '../hooks/useRooms';
import { useBuddyList } from '../hooks/useBuddyList';
import styles from './RoomDirectoryPage.module.css';

export function RoomDirectoryPage() {
  const { rooms, loading, error, refresh } = useRooms();
  const { buddies, doorEvents, loading: buddiesLoading, addBuddy, removeBuddy } = useBuddyList();
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
            doorEvents={doorEvents}
            loading={buddiesLoading}
            onAddBuddy={addBuddy}
            onRemoveBuddy={removeBuddy}
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
