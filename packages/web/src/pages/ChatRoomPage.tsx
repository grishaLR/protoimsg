import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { IS_TAURI } from '../lib/config';
import { useRoom } from '../hooks/useRoom';
import { useMessages } from '../hooks/useMessages';
import { useBlocks } from '../contexts/BlockContext';
import { useMentionNotifications } from '../contexts/MentionNotificationContext';
import { useContentTranslation } from '../hooks/useContentTranslation';
import { MessageList } from '../components/chat/MessageList';
import { MessageInput } from '../components/chat/MessageInput';
import { MemberList } from '../components/chat/MemberList';
import { ThreadPanel } from '../components/chat/ThreadPanel';
import { WindowControls } from '../components/layout/WindowControls';
import type { ChatThreadState } from '../hooks/useChatThread';
import styles from './ChatRoomPage.module.css';

export function ChatRoomPage() {
  const { t } = useTranslation('rooms');
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>{t('chatRoom.invalidId')}</p>;

  return <ChatRoomContent roomId={id} />;
}

function ChatRoomContent({ roomId }: { roomId: string }) {
  const { t } = useTranslation('rooms');
  const { room, members, doorEvents, loading: roomLoading, error: roomError } = useRoom(roomId);
  const {
    messages,
    replyCounts,
    loading: msgLoading,
    typingUsers,
    sendMessage,
    sendTyping,
  } = useMessages(roomId);
  const { blockedDids } = useBlocks();
  const { clearMentions } = useMentionNotifications();
  const {
    autoTranslate,
    available: translateAvailable,
    getTranslation,
    requestBatchTranslation,
  } = useContentTranslation();
  const lastTranslatedCount = useRef(0);

  // Clear unread mention badge when entering the room
  useEffect(() => {
    clearMentions(roomId);
  }, [roomId, clearMentions]);

  // Auto-translate chat messages when new ones arrive
  useEffect(() => {
    if (!autoTranslate || !translateAvailable || messages.length === 0) return;
    if (messages.length === lastTranslatedCount.current) return;

    const newMsgs = messages.slice(lastTranslatedCount.current);
    const texts = newMsgs.map((m) => m.text).filter(Boolean);

    lastTranslatedCount.current = messages.length;
    if (texts.length > 0) requestBatchTranslation(texts);
  }, [messages.length, autoTranslate, translateAvailable, messages, requestBatchTranslation]);

  // Thread panel state
  const [activeThread, setActiveThread] = useState<ChatThreadState | null>(null);

  const filteredMessages = useMemo(
    () => messages.filter((m) => !blockedDids.has(m.did)),
    [messages, blockedDids],
  );
  const filteredTyping = useMemo(
    () => typingUsers.filter((d) => !blockedDids.has(d)),
    [typingUsers, blockedDids],
  );

  const handleOpenThread = useCallback(
    (rootUri: string) => {
      setActiveThread({ rootUri, roomId });
    },
    [roomId],
  );

  const handleCloseThread = useCallback(() => {
    setActiveThread(null);
  }, []);

  if (roomLoading) return <div className={styles.loading}>{t('chatRoom.loading')}</div>;
  if (roomError) return <div className={styles.error}>{roomError}</div>;
  if (!room) return <div className={styles.error}>{t('chatRoom.notFound')}</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header} data-tauri-drag-region="">
        {!IS_TAURI && (
          <Link to="/" className={styles.back}>
            {'\u2190'} {t('chatRoom.backToRooms')}
          </Link>
        )}
        <h1 className={styles.roomName}>
          {(autoTranslate && getTranslation(room.name)) || room.name}
        </h1>
        {room.description && (
          <span className={styles.description}>
            {(autoTranslate && getTranslation(room.description)) || room.description}
          </span>
        )}
        <WindowControls />
      </header>
      <div className={styles.content}>
        <div className={styles.chatArea}>
          <MessageList
            messages={filteredMessages}
            loading={msgLoading}
            typingUsers={filteredTyping}
            replyCounts={replyCounts}
            onOpenThread={handleOpenThread}
          />
          <MessageInput
            onSend={(text) => {
              void sendMessage(text, room.uri);
            }}
            onTyping={sendTyping}
          />
        </div>
        {activeThread && (
          <ThreadPanel
            thread={activeThread}
            roomUri={room.uri}
            liveMessages={messages}
            onClose={handleCloseThread}
          />
        )}
        <aside className={styles.sidebar}>
          <MemberList members={members} doorEvents={doorEvents} />
        </aside>
      </div>
    </div>
  );
}
