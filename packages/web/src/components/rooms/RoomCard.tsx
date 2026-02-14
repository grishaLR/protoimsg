import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { RoomView } from '../../types';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { IS_TAURI } from '../../lib/config';
import styles from './RoomCard.module.css';

interface RoomCardProps {
  room: RoomView;
  mentionCount?: number;
}

function handleTauriClick(e: React.MouseEvent, room: RoomView) {
  e.preventDefault();
  void import('../../lib/tauri-windows').then(({ openRoomWindow }) => {
    void openRoomWindow(room.id, room.name);
  });
}

export function RoomCard({ room, mentionCount }: RoomCardProps) {
  const { t } = useTranslation('rooms');
  const {
    autoTranslate,
    available: translateAvailable,
    targetLang,
    getTranslation,
    isTranslating: isTranslatingText,
    requestTranslation,
  } = useContentTranslation();

  const [showTranslated, setShowTranslated] = useState(autoTranslate);

  const nameText = room.name;
  const descText = room.description ?? '';
  const topicText = room.topic;
  const translatedName = nameText ? getTranslation(nameText) : undefined;
  const translatedDesc = descText ? getTranslation(descText) : undefined;
  const translatedTopic = topicText ? getTranslation(topicText) : undefined;
  const hasTranslatableText = !!(nameText || descText || topicText);
  const translating =
    (nameText ? isTranslatingText(nameText) : false) ||
    (descText ? isTranslatingText(descText) : false) ||
    (topicText ? isTranslatingText(topicText) : false);
  const hasAnyTranslation = !!(translatedName || translatedDesc || translatedTopic);

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
        <h3 className={styles.name}>
          {showTranslated && translatedName ? translatedName : room.name}
        </h3>
        <span className={styles.badge}>{room.purpose}</span>
        {mentionCount != null && mentionCount > 0 && (
          <span className={styles.mentionBadge}>@{mentionCount}</span>
        )}
      </div>
      {room.topic && (
        <p className={styles.topic}>
          {showTranslated && translatedTopic ? translatedTopic : room.topic}
        </p>
      )}
      {room.description && (
        <p className={styles.description}>
          {showTranslated && translatedDesc ? translatedDesc : room.description}
        </p>
      )}
      <span className={styles.meta}>
        {t('roomCard.createdDate', { date: new Date(room.created_at).toLocaleDateString() })}
        {translateAvailable && hasTranslatableText && (
          <>
            {' \u00B7 '}
            {showTranslated && hasAnyTranslation ? (
              <>
                <span className={styles.translationLabel}>
                  {t('roomCard.translatedTo', { lang: targetLang })}
                </span>
                {' \u00B7 '}
                <button
                  type="button"
                  className={styles.showOriginal}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowTranslated(false);
                  }}
                >
                  {t('roomCard.showOriginal')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.translateBtn}
                disabled={translating}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (hasAnyTranslation) {
                    setShowTranslated(true);
                  } else {
                    if (nameText) requestTranslation(nameText);
                    if (descText) requestTranslation(descText);
                    if (topicText) requestTranslation(topicText);
                    setShowTranslated(true);
                  }
                }}
              >
                {translating ? t('roomCard.translating') : t('roomCard.translate')}
              </button>
            )}
          </>
        )}
      </span>
    </Link>
  );
}
