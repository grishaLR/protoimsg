import { useState, useEffect } from 'react';
import { RoomList } from '../components/rooms/RoomList';
import { CreateRoomModal } from '../components/rooms/CreateRoomModal';
import { WindowControls } from '../components/layout/WindowControls';
import { useRooms } from '../hooks/useRooms';
import { fetchCategories } from '../lib/api';
import styles from './RoomDirectoryWindowPage.module.css';

/**
 * Standalone room directory page for Tauri desktop window.
 * Route: /rooms-directory
 */
export function RoomDirectoryWindowPage() {
  const { rooms, loading, error, refresh } = useRooms();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchCategories({ signal: ac.signal })
      .then((cats) => {
        if (!ac.signal.aborted) setCategories(cats);
      })
      .catch(() => {});
    return () => {
      ac.abort();
    };
  }, []);

  const filtered = search
    ? rooms.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rooms;

  return (
    <div className={styles.container}>
      <div className={styles.header} data-tauri-drag-region="">
        <h2 className={styles.title}>Chat Rooms</h2>
        <WindowControls />
      </div>
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
      <div className={styles.body}>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <p className={styles.loading}>Loading rooms...</p>
        ) : (
          <RoomList rooms={filtered} />
        )}
      </div>
      {showCreate && (
        <CreateRoomModal
          categories={categories}
          onClose={() => {
            setShowCreate(false);
          }}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
            void fetchCategories()
              .then(setCategories)
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
