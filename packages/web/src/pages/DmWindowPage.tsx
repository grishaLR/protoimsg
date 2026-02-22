import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { conversations, openDm, closeDm, sendDm, sendTyping } = useDm();
  const { did } = useAuth();
  const { connected } = useWebSocket();
  const { t } = useTranslation('dm');
  const closingRef = useRef(false);

  const convo = conversations.find((c) => c.conversationId === conversationId);

  // Request the conversation once the WS IPC relay is connected.
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
          <span className={styles.headerTitle}>{t('window.connecting')}</span>
          <WindowControls />
        </div>
        <div className={styles.loading}>{t('window.waitingForConnection')}</div>
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
        {convo.peerState === 'connecting' && (
          <span className={styles.connectionState}>{t('popover.connecting')}</span>
        )}
        {convo.peerState === 'failed' && (
          <span className={styles.connectionFailed}>{t('popover.connectionFailed')}</span>
        )}
        {convo.peerState === 'closed' && (
          <span className={styles.connectionFailed}>{t('popover.peerClosed')}</span>
        )}
        <div className={styles.headerActions}>
          <WindowControls onClose={handleClose} />
        </div>
      </div>
      <div className={styles.body}>
        <DmMessageList messages={convo.messages} currentDid={did} typing={convo.typing} />
        <DmInput
          onSend={(text, facets) => {
            sendDm(convo.conversationId, text, facets);
          }}
          onSendWithEmbed={(text, embed) => {
            sendDm(convo.conversationId, text, undefined, embed);
          }}
          onTyping={() => {
            sendTyping(convo.conversationId);
          }}
        />
      </div>
    </div>
  );
}
