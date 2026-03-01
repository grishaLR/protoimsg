import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVideoCall } from '../contexts/VideoCallContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { UserIdentity } from '../components/chat/UserIdentity';
import { VideoCallOverlay } from '../components/videocall/VideoCallOverlay';
import { WindowControls } from '../components/layout/WindowControls';
import styles from './VideoCallWindowPage.module.css';

interface PendingVideoCall {
  conversationId: string;
  recipientDid: string;
  mode: 'outgoing' | 'incoming';
  offer?: string;
}

/**
 * Standalone full-window video call page for Tauri desktop windows.
 * Route: /videocall/:conversationId?recipientDid=...
 *
 * Bootstraps the call on mount using data stored in localStorage by the main window.
 * The WebRTC lifecycle is owned by this window's VideoCallContext;
 * all WS signaling flows through the IPC relay.
 */
export function VideoCallWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const recipientDid = searchParams.get('recipientDid');
  const { connected } = useWebSocket();
  const { activeCall, startOutgoingCall, bootstrapIncomingCall, hangUp } = useVideoCall();
  const { t } = useTranslation('chat');
  const bootstrappedRef = useRef(false);

  // Bootstrap the call once WS IPC relay is connected
  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!connected || !conversationId || !recipientDid) return;

    const raw = localStorage.getItem('protoimsg:pending-videocall');
    if (!raw) return;

    let pending: PendingVideoCall;
    try {
      pending = JSON.parse(raw) as PendingVideoCall;
    } catch {
      return;
    }

    if (pending.conversationId !== conversationId) return;

    bootstrappedRef.current = true;
    localStorage.removeItem('protoimsg:pending-videocall');

    if (pending.mode === 'outgoing') {
      startOutgoingCall(conversationId, recipientDid);
    } else if (pending.offer != null) {
      // mode === 'incoming' — accept with the stored SDP offer
      void bootstrapIncomingCall(conversationId, recipientDid, pending.offer);
    }
  }, [connected, conversationId, recipientDid, startOutgoingCall, bootstrapIncomingCall]);

  // Notify main window when this child closes
  useEffect(() => {
    return () => {
      void import('@tauri-apps/api/event').then(({ emit }) => {
        void emit('videocall-child-close');
      });
    };
  }, []);

  const handleClose = () => {
    if (activeCall) {
      hangUp();
    }
    void import('../lib/tauri-windows').then(({ closeCurrentWindow }) => {
      void closeCurrentWindow();
    });
  };

  if (!conversationId) return null;

  // While bootstrapping, show a loading state
  if (!activeCall) {
    return (
      <div className={styles.container}>
        <div className={styles.header} data-tauri-drag-region="">
          <span className={styles.headerTitle}>
            {recipientDid && <UserIdentity did={recipientDid} showAvatar size="sm" />}
          </span>
          <div className={styles.headerActions}>
            <WindowControls onClose={handleClose} />
          </div>
        </div>
        <div className={styles.loading}>
          {t('videoCall.connecting', { defaultValue: 'Connecting...' })}
        </div>
      </div>
    );
  }

  // Once active, render the full VideoCallOverlay in the window body
  return (
    <div className={styles.container}>
      <div className={styles.header} data-tauri-drag-region="">
        <span className={styles.headerTitle}>
          <UserIdentity did={activeCall.recipientDid} showAvatar size="sm" />
        </span>
        <div className={styles.headerActions}>
          <WindowControls onClose={handleClose} />
        </div>
      </div>
      <div className={styles.body}>
        <VideoCallOverlay />
      </div>
    </div>
  );
}
