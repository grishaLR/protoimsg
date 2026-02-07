import { useParams, Link } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom';
import { useMessages } from '../hooks/useMessages';
import { MessageList } from '../components/chat/MessageList';
import { MessageInput } from '../components/chat/MessageInput';
import { MemberList } from '../components/chat/MemberList';
import styles from './ChatRoomPage.module.css';

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Invalid room ID</p>;

  return <ChatRoomContent roomId={id} />;
}

function ChatRoomContent({ roomId }: { roomId: string }) {
  const { room, members, loading: roomLoading, error: roomError } = useRoom(roomId);
  const { messages, loading: msgLoading, sendMessage } = useMessages(roomId);

  if (roomLoading) return <div className={styles.loading}>Room is being set up...</div>;
  if (roomError) return <div className={styles.error}>{roomError}</div>;
  if (!room) return <div className={styles.error}>Room not found</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          &larr; Rooms
        </Link>
        <h1 className={styles.roomName}>{room.name}</h1>
        {room.description && <span className={styles.description}>{room.description}</span>}
      </header>
      <div className={styles.content}>
        <div className={styles.chatArea}>
          <MessageList messages={messages} loading={msgLoading} />
          <MessageInput
            onSend={(text) => {
              void sendMessage(text, room.uri);
            }}
          />
        </div>
        <aside className={styles.sidebar}>
          <MemberList members={members} />
        </aside>
      </div>
    </div>
  );
}
