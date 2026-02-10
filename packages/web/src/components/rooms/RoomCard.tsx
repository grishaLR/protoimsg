import { Link } from 'react-router-dom';
import type { RoomView } from '../../types';
import { IS_TAURI } from '../../lib/config';
import styles from './RoomCard.module.css';

interface RoomCardProps {
  room: RoomView;
}

function handleTauriClick(e: React.MouseEvent, room: RoomView) {
  e.preventDefault();
  void import('../../lib/tauri-windows').then(({ openRoomWindow }) => {
    void openRoomWindow(room.id, room.name);
  });
}

export function RoomCard({ room }: RoomCardProps) {
  return (
    <Link
      to={`/rooms/${room.id}`}
      className={styles.card}
      onClick={
        IS_TAURI
          ? (e) => {
              handleTauriClick(e, room);
            }
          : undefined
      }
    >
      <div className={styles.header}>
        <h3 className={styles.name}>{room.name}</h3>
        <span className={styles.badge}>{room.purpose}</span>
      </div>
      {room.description && <p className={styles.description}>{room.description}</p>}
      <span className={styles.meta}>Created {new Date(room.created_at).toLocaleDateString()}</span>
    </Link>
  );
}
