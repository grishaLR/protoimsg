import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { IS_TAURI } from '../lib/config';
import { useRoom } from '../hooks/useRoom';
import { useMessages } from '../hooks/useMessages';
import { useBlocks } from '../contexts/BlockContext';
import { MessageList } from '../components/chat/MessageList';
import { MessageInput } from '../components/chat/MessageInput';
import { MemberList } from '../components/chat/MemberList';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './ChatRoomPage.module.css';

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Invalid room ID</p>;

  return <ChatRoomContent roomId={id} />;
}

function ChatRoomContent({ roomId }: { roomId: string }) {
  const { room, members, doorEvents, loading: roomLoading, error: roomError } = useRoom(roomId);
  const {
    messages,
    loading: msgLoading,
    typingUsers,
    sendMessage,
    sendTyping,
  } = useMessages(roomId);
  const { blockedDids } = useBlocks();

  const filteredMessages = useMemo(
    () => messages.filter((m) => !blockedDids.has(m.did)),
    [messages, blockedDids],
  );
  const filteredTyping = useMemo(
    () => typingUsers.filter((d) => !blockedDids.has(d)),
    [typingUsers, blockedDids],
  );

  if (roomLoading) return <div className={styles.loading}>Room is being set up...</div>;
  if (roomError) return <div className={styles.error}>{roomError}</div>;
  if (!room) return <div className={styles.error}>Room not found</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header} data-tauri-drag-region="">
        {!IS_TAURI && (
          <Link to="/" className={styles.back}>
            &larr; Rooms
          </Link>
        )}
        <h1 className={styles.roomName}>{room.name}</h1>
        {room.description && <span className={styles.description}>{room.description}</span>}
        <WindowControls />
      </header>
      <div className={styles.content}>
        <div className={styles.chatArea}>
          <MessageList
            messages={filteredMessages}
            loading={msgLoading}
            typingUsers={filteredTyping}
          />
          <MessageInput
            onSend={(text) => {
              void sendMessage(text, room.uri);
            }}
            onTyping={sendTyping}
          />
        </div>
        <aside className={styles.sidebar}>
          <MemberList members={members} doorEvents={doorEvents} />
        </aside>
      </div>
    </div>
  );
}
