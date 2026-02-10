import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useDm } from '../contexts/DmContext';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../contexts/WebSocketContext';
import { UserIdentity } from '../components/chat/UserIdentity';
import { DmMessageList } from '../components/dm/DmMessageList';
import { DmInput } from '../components/dm/DmInput';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './DmWindowPage.module.css';

/**
 * Standalone full-window DM page for Tauri desktop windows.
 * Route: /dm/:conversationId?recipientDid=...
 * On mount, re-requests the conversation from the server via DmContext.openDm()
 * since this window has its own fresh React state.
 */
export function DmWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const recipientDid = searchParams.get('recipientDid');
  const { conversations, openDm, closeDm, sendDm, sendTyping, togglePersist } = useDm();
  const { did } = useAuth();
  const { connected } = useWebSocket();
  const closingRef = useRef(false);

  const convo = conversations.find((c) => c.conversationId === conversationId);

  // Request the conversation once the WS IPC relay is connected.
  // openDm is a no-op if already in state (deduped via conversationsRef).
  // Skip if the window is being closed (closeDm removes convo from state,
  // which would otherwise re-trigger this effect and reopen the DM).
  useEffect(() => {
    if (closingRef.current) return;
    if (!connected || !recipientDid || !did || convo) return;
    openDm(recipientDid);
  }, [connected, recipientDid, did, convo, openDm]);

  if (!did || !conversationId) return null;

  if (!convo) {
    return (
      <div className={styles.container}>
        <div className={styles.header} data-tauri-drag-region="">
          <span className={styles.headerTitle}>Connecting...</span>
          <WindowControls />
        </div>
        <div className={styles.loading}>Waiting for connection...</div>
      </div>
    );
  }

  const handleClose = () => {
    closingRef.current = true;
    closeDm(convo.conversationId);
    void import('../lib/tauri-windows').then(({ closeCurrentWindow }) => {
      void closeCurrentWindow();
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header} data-tauri-drag-region="">
        <span className={styles.headerIdentity}>
          <UserIdentity did={convo.recipientDid} showAvatar size="sm" />
        </span>
        <div className={styles.headerActions}>
          <button
            className={`${styles.headerBtn} ${convo.persist ? styles.persistActive : ''}`}
            onClick={() => {
              togglePersist(convo.conversationId, !convo.persist);
            }}
            title={convo.persist ? 'Messages saved (7 days)' : 'Messages ephemeral — click to save'}
          >
            {convo.persist ? '\uD83D\uDCBE' : '\u2601\uFE0F'}
          </button>
          <WindowControls onClose={handleClose} />
        </div>
      </div>
      <div className={styles.body}>
        <DmMessageList messages={convo.messages} currentDid={did} typing={convo.typing} />
        <DmInput
          onSend={(text) => {
            sendDm(convo.conversationId, text);
          }}
          onTyping={() => {
            sendTyping(convo.conversationId);
          }}
        />
      </div>
    </div>
  );
}
