import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useLocalParticipant,
  useRoomContext,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { useDragResize } from '../../../hooks/useDragResize';
import { CallHeader } from './CallHeader';
import { ChatPanel } from './ChatPanel';
import { ControlBar } from './ControlBar';
import { FloatingEmojiOverlay } from './FloatingEmojiOverlay';
import { NamePrompt } from './NamePrompt';
import { RemoteAudioTracks } from './RemoteAudioTracks';
import { VideoGrid } from './VideoGrid';
import { useGroupCallData } from './useGroupCallData';
import { DISPLAY_NAME_KEY } from './types';
import styles from '../VideoCallOverlay.module.css';

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/**
 * Orchestrates the group call: owns the LiveKit room handle, display name, and
 * the PiP compositor. The expensive subtrees (grid, header, chat, controls) are
 * memoized children, so chat/emoji state changes here don't re-render the video.
 */
export function GroupCallInner({ onLeave, meetCode }: { onLeave: () => void; meetCode: string }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) || '',
  );
  const [showNamePrompt, setShowNamePrompt] = useState(!displayName);
  const [chatOpen, setChatOpen] = useState(false);

  const {
    chatMessages,
    floatingEmojis,
    unreadCount,
    names,
    namesRef,
    sendChat,
    sendEmoji,
    clearUnread,
  } = useGroupCallData({ room, localParticipant, displayName, chatOpen });

  // ── PiP refs — VideoGrid fills these; the compositor below reads them ──
  const tileVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const pipTracksRef = useRef<TrackReferenceOrPlaceholder[]>([]);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── Drag/resize ──
  const {
    containerRef,
    posStyle,
    sizeStyle,
    onDragStart,
    onPointerMove,
    onPointerUp,
    onResizeStart,
    reset,
  } = useDragResize({ minWidth: 320, minHeight: 240 });

  useEffect(() => {
    reset();
  }, []);

  // Persist the display name once chosen.
  useEffect(() => {
    if (displayName) localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  }, [displayName]);

  // Clear the unread badge when the chat panel opens.
  useEffect(() => {
    if (chatOpen) clearUnread();
  }, [chatOpen, clearUnread]);

  // ── PiP canvas compositor — composites the on-screen tiles into one stream ──
  useEffect(() => {
    const display = displayVideoRef.current;
    if (!display) return;
    if (!pipCanvasRef.current) pipCanvasRef.current = document.createElement('canvas');
    const canvas = pipCanvasRef.current;
    const W = 640,
      H = 480;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    display.srcObject = canvas.captureStream(30);
    display.play().catch(() => {});

    let frameId: number;
    const draw = () => {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
      const tracks = pipTracksRef.current;
      const n = tracks.length || 1;
      const c = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
      const r = Math.ceil(n / c);
      const tW = Math.floor(W / c),
        tH = Math.floor(H / r),
        gap = 2;

      let i = 0;
      for (const tr of tracks) {
        const col = i % c,
          row = Math.floor(i / c);
        const tx = col * tW + gap,
          ty = row * tH + gap,
          tw = tW - gap * 2,
          th = tH - gap * 2;
        const vid = tileVideoRefs.current.get(`${tr.participant.sid}:${tr.source}`);
        if (vid && vid.readyState >= 2) {
          const vw = vid.videoWidth || tw,
            vh = vid.videoHeight || th;
          const scale = Math.min(tw / vw, th / vh);
          const dw = vw * scale,
            dh = vh * scale;
          if (tr.participant.isLocal) {
            ctx.save();
            ctx.translate(tx + tw, ty);
            ctx.scale(-1, 1);
            ctx.drawImage(vid, (tw - dw) / 2, (th - dh) / 2, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(vid, tx + (tw - dw) / 2, ty + (th - dh) / 2, dw, dh);
          }
        } else {
          ctx.fillStyle = '#2a2a3e';
          ctx.fillRect(tx, ty, tw, th);
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = `bold ${Math.round(th * 0.2)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label =
            namesRef.current[tr.participant.identity] ??
            (tr.participant.isLocal ? 'You' : tr.participant.identity.slice(0, 6));
          ctx.fillText(label, tx + tw / 2, ty + th / 2);
        }
        i++;
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      if (document.pictureInPictureElement === display)
        document.exitPictureInPicture().catch(() => {});
      display.srcObject = null;
    };
  }, [showNamePrompt]);

  // Auto-PiP when the tab is hidden.
  useEffect(() => {
    const handler = () => {
      const v = displayVideoRef.current;
      if (!v || !document.pictureInPictureEnabled) return;
      if (document.hidden) {
        if (!document.pictureInPictureElement) v.requestPictureInPicture().catch(() => {});
      } else {
        if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
    };
  }, []);

  // ── Stable handlers ──
  const handleLeave = useCallback(() => {
    void room.disconnect();
    onLeave();
  }, [room, onLeave]);

  const toggleChat = useCallback(() => {
    setChatOpen((o) => !o);
  }, []);

  const requestPip = useCallback(() => {
    displayVideoRef.current?.requestPictureInPicture().catch(() => {});
  }, []);

  const handleJoin = useCallback((name: string) => {
    setDisplayName(name);
    setShowNamePrompt(false);
  }, []);

  const handleSkip = useCallback(() => {
    setDisplayName('Anonymous');
    setShowNamePrompt(false);
  }, []);

  // ── Name prompt ──
  if (showNamePrompt) {
    return (
      <div
        ref={containerRef}
        className={styles.container}
        style={{ ...posStyle, ...sizeStyle }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className={styles.header}
          onPointerDown={onDragStart}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <span className={styles.headerIdentity}>Set your name</span>
        </div>
        <NamePrompt onJoin={handleJoin} onSkip={handleSkip} />
      </div>
    );
  }

  // ── Call ──
  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ ...posStyle, ...sizeStyle }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`${styles.resizeHandle} ${styles[`resize${dir.toUpperCase()}` as keyof typeof styles]}`}
          onPointerDown={(e) => {
            onResizeStart(dir, e);
          }}
        />
      ))}

      <CallHeader meetCode={meetCode} onLeave={handleLeave} onDragStart={onDragStart} />

      {/* Video + Chat row */}
      <div style={{ display: 'flex', flex: 1, minHeight: 200, overflow: 'hidden' }}>
        <div style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
          <VideoGrid
            tileVideoRefs={tileVideoRefs}
            pipTracksRef={pipTracksRef}
            participantNames={names}
          />
          <FloatingEmojiOverlay emojis={floatingEmojis} />
          {/* Hidden source video — feeds the PiP compositor */}
          <video ref={displayVideoRef} className={styles.hiddenSource} autoPlay playsInline muted />
          <RemoteAudioTracks />
        </div>
        {chatOpen && (
          <ChatPanel
            messages={chatMessages}
            localIdentity={localParticipant.identity}
            onSend={sendChat}
          />
        )}
      </div>

      <ControlBar
        localParticipant={localParticipant}
        chatOpen={chatOpen}
        unreadCount={unreadCount}
        onToggleChat={toggleChat}
        onSendEmoji={sendEmoji}
        onRequestPip={requestPip}
        onLeave={handleLeave}
      />
    </div>
  );
}
