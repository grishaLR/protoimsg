import { useState } from 'react';
import { Header } from '../components/layout/Header';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { useRooms } from '../hooks/useRooms';
import styles from './RoomDirectoryPage.module.css';

export function RoomDirectoryPage() {
  const { rooms, loading, error, refresh } = useRooms();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = search
    ? rooms.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rooms;

  return (
    <div className={styles.page}>
      <Header />
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
