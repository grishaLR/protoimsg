import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RoomCard } from './RoomCard';
import { useMentionNotifications } from '../../contexts/MentionNotificationContext';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import type { RoomView } from '../../types';
import styles from './RoomList.module.css';

interface RoomListProps {
  rooms: RoomView[];
}

export function RoomList({ rooms }: RoomListProps) {
  const { t } = useTranslation('rooms');
  const { unreadMentions } = useMentionNotifications();
  const {
    autoTranslate,
    available: translateAvailable,
    requestBatchTranslation,
  } = useContentTranslation();
  const lastTranslatedCount = useRef(0);

  // Auto-translate room descriptions and topics when rooms load
  useEffect(() => {
    if (!autoTranslate || !translateAvailable || rooms.length === 0) return;
    if (rooms.length === lastTranslatedCount.current) return;

    const texts = rooms
      .flatMap((r) => [r.name, r.topic, r.description])
      .filter((t): t is string => !!t);

    lastTranslatedCount.current = rooms.length;
    if (texts.length > 0) requestBatchTranslation(texts);
  }, [rooms.length, autoTranslate, translateAvailable, rooms, requestBatchTranslation]);

  if (rooms.length === 0) {
    return <p className={styles.empty}>{t('roomList.empty')}</p>;
  }

  return (
    <div className={styles.list}>
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} mentionCount={unreadMentions[room.id]} />
      ))}
    </div>
  );
}
