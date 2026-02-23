import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { IS_TAURI } from '../lib/config';
import { useRoom } from '../hooks/useRoom';
import { useMessages } from '../hooks/useMessages';
import { usePolls } from '../hooks/usePolls';
import { useBlocks } from '../contexts/BlockContext';
import { useMentionNotifications } from '../contexts/MentionNotificationContext';
import { useContentTranslation } from '../hooks/useContentTranslation';
import { useAuth } from '../hooks/useAuth';
import { MessageList } from '../components/chat/MessageList';
import { MessageInput } from '../components/chat/MessageInput';
import { MemberList } from '../components/chat/MemberList';
import { ThreadPanel } from '../components/chat/ThreadPanel';
import { ChannelList } from '../components/chat/ChannelList';
import { ChannelSwitcher } from '../components/chat/ChannelSwitcher';
import { CreateChannelModal } from '../components/chat/CreateChannelModal';
import { ReportContentModal } from '../components/feedback/ReportContentModal';
import { ArrowLeft, Flag, PanelLeftOpen } from 'lucide-react';
import { WindowControls } from '../components/layout/WindowControls';
import { LoadingBars } from '../components/LoadingBars';
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
  const { did } = useAuth();
  const {
    room,
    members,
    channels,
    doorEvents,
    loading: roomLoading,
    error: roomError,
  } = useRoom(roomId);

  // Active channel state — auto-select default channel when channels arrive
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (channels.length > 0 && !activeChannelId) {
      const defaultChannel = channels.find((ch) => ch.isDefault);
      setActiveChannelId(defaultChannel?.id ?? channels[0]?.id ?? null);
    }
    // If active channel was deleted, switch to default
    if (activeChannelId && !channels.find((ch) => ch.id === activeChannelId)) {
      const defaultChannel = channels.find((ch) => ch.isDefault);
      setActiveChannelId(defaultChannel?.id ?? channels[0]?.id ?? null);
    }
  }, [channels, activeChannelId]);

  const activeChannel = useMemo(
    () => channels.find((ch) => ch.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const {
    messages,
    replyCounts,
    loading: msgLoading,
    typingUsers,
    sendMessage,
    sendTyping,
  } = useMessages(roomId, activeChannelId);
  const { polls, createPoll, castVote } = usePolls(roomId, activeChannelId);
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

  // Reset translate counter when channel changes
  useEffect(() => {
    lastTranslatedCount.current = 0;
  }, [activeChannelId]);

  // Thread panel state
  const [activeThread, setActiveThread] = useState<ChatThreadState | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    uri: string;
    label: string;
    roomId?: string;
  } | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelSidebarOpen, setChannelSidebarOpen] = useState(() => {
    const stored = localStorage.getItem('protoimsg:channelSidebarOpen');
    return stored !== 'false';
  });

  const toggleChannelSidebar = useCallback(() => {
    setChannelSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('protoimsg:channelSidebarOpen', String(next));
      return next;
    });
  }, []);

  const [sendError, setSendError] = useState<string | null>(null);

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
      if (!activeChannelId) return;
      setActiveThread({ rootUri, roomId, channelId: activeChannelId });
    },
    [roomId, activeChannelId],
  );

  const handleCloseThread = useCallback(() => {
    setActiveThread(null);
  }, []);

  const handleReport = useCallback(
    (messageUri: string, preview: string) => {
      setReportTarget({ uri: messageUri, label: preview, roomId });
    },
    [roomId],
  );

  // Close thread when switching channels
  useEffect(() => {
    setActiveThread(null);
  }, [activeChannelId]);

  const isOwner = room?.did === did;

  if (roomLoading)
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          {!IS_TAURI && (
            <Link to="/" state={{ tab: 'rooms' }} className={styles.back}>
              <ArrowLeft size={14} /> {t('chatRoom.backToRooms')}
            </Link>
          )}
        </header>
        <div className={styles.loadingBody}>
          <LoadingBars />
        </div>
      </div>
    );
  if (roomError) return <div className={styles.error}>{roomError}</div>;
  if (!room) return <div className={styles.error}>{t('chatRoom.notFound')}</div>;

  return (
    <div className={styles.page}>
      <header className={styles.header} data-tauri-drag-region="">
        {!IS_TAURI && (
          <Link to="/" state={{ tab: 'rooms' }} className={styles.back}>
            <ArrowLeft size={14} /> {t('chatRoom.backToRooms')}
          </Link>
        )}
        <h1 className={styles.roomName}>
          {(autoTranslate && getTranslation(room.name)) || room.name}
        </h1>
        <ChannelSwitcher
          channels={channels}
          activeChannel={activeChannel}
          onSelect={setActiveChannelId}
          onCreateChannel={
            isOwner
              ? () => {
                  setShowCreateChannel(true);
                }
              : undefined
          }
        />
        {room.description && (
          <span className={styles.description}>
            {(autoTranslate && getTranslation(room.description)) || room.description}
          </span>
        )}
        <button
          className={styles.membersBtn}
          type="button"
          onClick={() => {
            setShowMembers((v) => !v);
          }}
        >
          {t('chatRoom.members')}
        </button>
        {!isOwner && (
          <button
            className={styles.reportRoomBtn}
            type="button"
            onClick={() => {
              setReportTarget({ uri: room.uri, label: room.name, roomId });
            }}
            title={t('chatRoom.reportRoom')}
            aria-label={t('chatRoom.reportRoom')}
          >
            <Flag size={14} />
          </button>
        )}
        <WindowControls />
      </header>
      <div className={styles.content}>
        {channels.length > 1 &&
          (channelSidebarOpen ? (
            <aside className={styles.channelSidebar}>
              <ChannelList
                channels={channels}
                activeChannelId={activeChannelId}
                onSelect={setActiveChannelId}
                canCreate={isOwner}
                onCreateChannel={() => {
                  setShowCreateChannel(true);
                }}
                onCollapse={toggleChannelSidebar}
              />
            </aside>
          ) : (
            <button
              className={styles.expandSidebarBtn}
              type="button"
              onClick={toggleChannelSidebar}
              aria-label={t('chatRoom.expandChannels')}
              title={t('chatRoom.expandChannels')}
            >
              <PanelLeftOpen size={14} />
            </button>
          ))}
        <div className={styles.chatArea}>
          <MessageList
            messages={filteredMessages}
            polls={polls}
            loading={msgLoading}
            typingUsers={filteredTyping}
            replyCounts={replyCounts}
            onOpenThread={handleOpenThread}
            onReport={handleReport}
            onVote={(pollId, pollUri, opts) => {
              void castVote(pollId, pollUri, opts);
            }}
          />
          {sendError && (
            <div className={styles.sendError} role="alert">
              {sendError}
              <button
                type="button"
                onClick={() => {
                  setSendError(null);
                }}
              >
                {t('chatRoom.dismiss')}
              </button>
            </div>
          )}
          <MessageInput
            onSend={(text) => {
              if (activeChannel) {
                setSendError(null);
                sendMessage(text, activeChannel.uri).catch(() => {
                  setSendError(t('chatRoom.sendFailed'));
                });
              }
            }}
            onTyping={sendTyping}
            onCreatePoll={(input) => {
              if (activeChannel) void createPoll(input, activeChannel.uri);
            }}
            onSendWithEmbed={(text, embed) => {
              if (activeChannel) {
                setSendError(null);
                sendMessage(text, activeChannel.uri, undefined, embed).catch(() => {
                  setSendError(t('chatRoom.sendFailed'));
                });
              }
            }}
          />
        </div>
        {activeThread && activeChannel && (
          <ThreadPanel
            thread={activeThread}
            channelUri={activeChannel.uri}
            liveMessages={messages}
            onClose={handleCloseThread}
            onReport={handleReport}
          />
        )}
        <aside className={`${styles.sidebar} ${showMembers ? styles.sidebarOpen : ''}`}>
          <button
            className={styles.membersPanelClose}
            type="button"
            onClick={() => {
              setShowMembers(false);
            }}
          >
            <ArrowLeft size={14} />
          </button>
          <MemberList members={members} doorEvents={doorEvents} />
        </aside>
      </div>
      {showCreateChannel && (
        <CreateChannelModal
          roomUri={room.uri}
          onClose={() => {
            setShowCreateChannel(false);
          }}
        />
      )}
      {reportTarget && (
        <ReportContentModal
          subjectUri={reportTarget.uri}
          subjectLabel={reportTarget.label}
          roomId={reportTarget.roomId}
          onClose={() => {
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}
