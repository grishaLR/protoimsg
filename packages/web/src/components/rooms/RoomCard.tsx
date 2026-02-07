import { Link } from 'react-router-dom';
import type { RoomView } from '../../types';
import styles from './RoomCard.module.css';

interface RoomCardProps {
  room: RoomView;
}

export function RoomCard({ room }: RoomCardProps) {
  return (
    <Link to={`/rooms/${room.id}`} className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.name}>{room.name}</h3>
        <span className={styles.badge}>{room.purpose}</span>
      </div>
      {room.description && <p className={styles.description}>{room.description}</p>}
      <span className={styles.meta}>Created {new Date(room.created_at).toLocaleDateString()}</span>
    </Link>
  );
}
