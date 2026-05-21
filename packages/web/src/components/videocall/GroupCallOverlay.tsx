import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PhoneOff,
  MicOff,
  Mic,
  VideoOff,
  Video,
  MonitorUp,
  MonitorOff,
  X,
  PictureInPicture2,
  Copy,
  Check,
  Users,
  MessageSquare,
  Send,
  Smile,
  Share2,
  Mail,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import '@livekit/components-styles';
import {
  LiveKitRoom,
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useParticipants,
  VideoTrack,
  AudioTrack,
  type TrackReference,
} from '@livekit/components-react';
import { Track, RoomEvent, VideoPresets } from 'livekit-client';
import type { RemoteParticipant, Participant, RoomOptions } from 'livekit-client';
import { useGroupCall } from '../../contexts/GroupCallContext';
import { useDragResize } from '../../hooks/useDragResize';
import styles from './VideoCallOverlay.module.css';

// ── Constants ──

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '😮', '💯'];
const DISPLAY_NAME_KEY = 'protoimsg:groupCallName';
const AUTO_FOCUS_KEY = 'protoimsg:groupCallAutoFocus';

/**
 * Max video tiles mounted at once. Tiles beyond this are paginated; since
 * unmounted tracks have no <VideoTrack> element, adaptiveStream pauses them
 * server-side, so a 100+ person call only ever streams ~this many videos.
 */
const MAX_VISIBLE_TILES = 25;

/**
 * Room options tuned for large calls:
 * - adaptiveStream: pauses/downscales tracks based on rendered element size
 * - dynacast: stops publishing simulcast layers nobody is subscribed to
 * - simulcast layers: lets the SFU send a cheap layer to small grid tiles
 */
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  },
};

interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  text: string;
  ts: number;
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number; // % from left
  ts: number;
}

// ── Data channel codec ──

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type DataMsg =
  | { type: 'chat'; id: string; sender: string; senderName: string; text: string }
  | { type: 'emoji'; emoji: string; sender: string }
  | { type: 'name'; sender: string; name: string };

function encodeData(msg: DataMsg): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

function decodeData(data: Uint8Array): DataMsg | null {
  try {
    return JSON.parse(decoder.decode(data)) as DataMsg;
  } catch {
    return null;
  }
}

// ── Audio tracks ──

function RemoteAudioTracks() {
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  const remote = audioTracks.filter(
    (t): t is TrackReference => !t.participant.isLocal && !!t.publication?.track,
  );
  return (
    <>
      {remote.map((t) => (
        <AudioTrack key={t.participant.sid + '-audio'} trackRef={t} />
      ))}
    </>
  );
}

// ── Floating emoji animation ──

function FloatingEmojiOverlay({ emojis }: { emojis: FloatingEmoji[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {emojis.map((e) => (
        <span
          key={e.id}
          style={{
            position: 'absolute',
            left: `${e.x}%`,
            bottom: 0,
            fontSize: '2rem',
            animation: 'groupCallEmojiFloat 2.5s ease-out forwards',
            pointerEvents: 'none',
          }}
        >
          {e.emoji}
        </span>
      ))}
    </div>
  );
}

// ── Main inner component ──

function GroupCallInner({ onLeave, meetCode }: { onLeave: () => void; meetCode: string }) {
  const { t } = useTranslation('common');
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();

  // ── Media state ──
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // ── Display name (persisted) ──
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) || '',
  );
  const [showNamePrompt, setShowNamePrompt] = useState(!displayName);
  const [nameInput, setNameInput] = useState(displayName);
  const participantNames = useRef<Map<string, string>>(new Map());

  // ── Chat ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Emoji reactions ──
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // ── Focus / pin (keyed by "sid:source" to distinguish camera vs screen share) ──
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [autoFocus, _setAutoFocus] = useState(
    () => localStorage.getItem(AUTO_FOCUS_KEY) !== 'false',
  );
  const [activeSpeakerSid, setActiveSpeakerSid] = useState<string | null>(null);

  // ── Pagination ──
  const [page, setPage] = useState(0);

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

  // ── Video tracks ──
  const videoTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  // PiP refs
  const tileVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  /** Tracks the PiP canvas should composite — the focused tile + current page. */
  const pipTracksRef = useRef<typeof videoTracks>([]);

  // ── Set display name on join ──
  useEffect(() => {
    if (!displayName) return;
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
    participantNames.current.set(localParticipant.identity, displayName);
    // Broadcast name to all participants
    const msg = encodeData({ type: 'name', sender: localParticipant.identity, name: displayName });
    localParticipant.publishData(msg, { reliable: true }).catch(() => {});
  }, [displayName, localParticipant]);

  // ── Active speaker detection ──
  useEffect(() => {
    const handler = (speakers: Participant[]) => {
      const remote = speakers.find((s) => !s.isLocal);
      if (remote) {
        setActiveSpeakerSid(remote.sid);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handler);
    };
  }, [room]);

  // ── Auto-pin screen share or active speaker ──
  const screenShareTrack = videoTracks.find(
    (t) => t.source === Track.Source.ScreenShare && !t.participant.isLocal,
  );

  /** Build a unique key for a track: "sid:source" */
  const trackKey = (t: { participant: { sid: string }; source: Track.Source }) =>
    `${t.participant.sid}:${t.source}`;

  const effectivePinned = useMemo(() => {
    if (pinnedKey) return pinnedKey; // manual pin takes priority
    if (screenShareTrack) return trackKey(screenShareTrack); // auto-pin screen share
    if (autoFocus && activeSpeakerSid) return `${activeSpeakerSid}:${Track.Source.Camera}`; // auto-focus speaker
    return null;
  }, [pinnedKey, screenShareTrack, activeSpeakerSid, autoFocus]);

  // ── Data channel handler ──
  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: RemoteParticipant) => {
      const msg = decodeData(payload);
      if (!msg) return;

      switch (msg.type) {
        case 'chat': {
          const chatMsg: ChatMessage = {
            id: msg.id,
            sender: msg.sender,
            senderName: msg.senderName,
            text: msg.text,
            ts: Date.now(),
          };
          setChatMessages((prev) => [...prev.slice(-200), chatMsg]);
          if (!chatOpen) setUnreadCount((c) => c + 1);
          break;
        }
        case 'emoji': {
          const fe: FloatingEmoji = {
            id: `${Date.now()}-${Math.random()}`,
            emoji: msg.emoji,
            x: 10 + Math.random() * 80,
            ts: Date.now(),
          };
          setFloatingEmojis((prev) => [...prev, fe]);
          setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== fe.id));
          }, 3000);
          break;
        }
        case 'name': {
          participantNames.current.set(msg.sender, msg.name);
          break;
        }
      }
    };

    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room, chatOpen]);

  // ── Broadcast name when new participant joins ──
  useEffect(() => {
    if (!displayName) return;
    const handler = () => {
      const msg = encodeData({
        type: 'name',
        sender: localParticipant.identity,
        name: displayName,
      });
      localParticipant.publishData(msg, { reliable: true }).catch(() => {});
    };
    room.on(RoomEvent.ParticipantConnected, handler);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handler);
    };
  }, [room, localParticipant, displayName]);

  // ── Scroll chat to bottom ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // ── PiP canvas ──
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
            participantNames.current.get(tr.participant.identity) ??
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

  // Auto PiP
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

  // ── Actions ──
  const toggleMute = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(isMuted);
    setIsMuted(!isMuted);
  }, [localParticipant, isMuted]);

  const toggleCamera = useCallback(async () => {
    await localParticipant.setCameraEnabled(isCameraOff);
    setIsCameraOff(!isCameraOff);
  }, [localParticipant, isCameraOff]);

  const toggleScreenShare = useCallback(async () => {
    await localParticipant.setScreenShareEnabled(!isScreenSharing);
    setIsScreenSharing(!isScreenSharing);
  }, [localParticipant, isScreenSharing]);

  const handleLeave = useCallback(() => {
    void room.disconnect();
    onLeave();
  }, [room, onLeave]);

  const [showShareMenu, setShowShareMenu] = useState(false);

  // Close share menu when clicking anywhere else (setTimeout avoids catching the opening click)
  useEffect(() => {
    if (!showShareMenu) return;
    const close = () => {
      setShowShareMenu(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [showShareMenu]);

  const meetUrl = meetCode ? `${window.location.origin}/meet/${meetCode}` : '';
  const shareText = meetCode ? `Join my protoimsg video call: ${meetUrl}` : '';

  const copyMeetCode = useCallback(() => {
    if (!meetUrl) return;
    void navigator.clipboard.writeText(meetUrl);
    setCodeCopied(true);
    setShowShareMenu(false);
    setTimeout(() => {
      setCodeCopied(false);
    }, 2000);
  }, [meetUrl]);

  const shareViaEmail = useCallback(() => {
    if (!shareText) return;
    window.open(
      `mailto:?subject=${encodeURIComponent('Join my video call')}&body=${encodeURIComponent(shareText)}`,
    );
    setShowShareMenu(false);
  }, [shareText]);

  const shareViaBluesky = useCallback(() => {
    if (!shareText) return;
    window.open(`https://bsky.app/intent/compose?text=${encodeURIComponent(shareText)}`, '_blank');
    setShowShareMenu(false);
  }, [shareText]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    const msg: DataMsg = {
      type: 'chat',
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: localParticipant.identity,
      senderName: displayName || 'You',
      text,
    };
    localParticipant.publishData(encodeData(msg), { reliable: true }).catch(() => {});
    setChatMessages((prev) => [...prev.slice(-200), { ...msg, ts: Date.now() }]);
    setChatInput('');
  }, [chatInput, localParticipant, displayName]);

  const sendEmoji = useCallback(
    (emoji: string) => {
      const msg: DataMsg = { type: 'emoji', emoji, sender: localParticipant.identity };
      localParticipant.publishData(encodeData(msg), { reliable: true }).catch(() => {});
      // Show locally too
      const fe: FloatingEmoji = {
        id: `${Date.now()}-self`,
        emoji,
        x: 10 + Math.random() * 80,
        ts: Date.now(),
      };
      setFloatingEmojis((prev) => [...prev, fe]);
      setTimeout(() => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== fe.id));
      }, 3000);
    },
    [localParticipant],
  );

  const toggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  const handleNameSubmit = useCallback(() => {
    const name = nameInput.trim();
    if (name) {
      setDisplayName(name);
      setShowNamePrompt(false);
    }
  }, [nameInput]);

  // ── Grid layout ──
  // If someone is pinned/focused: they get the big tile, others are small strip
  const hasFocus = effectivePinned && videoTracks.length > 1;
  const focusedTrack = hasFocus ? videoTracks.find((t) => trackKey(t) === effectivePinned) : null;
  const otherTracks = hasFocus
    ? videoTracks.filter((t) => trackKey(t) !== effectivePinned)
    : videoTracks;

  // ── Pagination ──
  // Local participant ordered first so "you" stay visible across page flips.
  const orderedTracks = useMemo(() => {
    const local = otherTracks.filter((t) => t.participant.isLocal);
    const remote = otherTracks.filter((t) => !t.participant.isLocal);
    return [...local, ...remote];
  }, [otherTracks]);

  const pageCount = Math.max(1, Math.ceil(orderedTracks.length / MAX_VISIBLE_TILES));
  const safePage = Math.min(page, pageCount - 1);
  const visibleTracks = orderedTracks.slice(
    safePage * MAX_VISIBLE_TILES,
    safePage * MAX_VISIBLE_TILES + MAX_VISIBLE_TILES,
  );

  // Clamp the page when participants leave and the current page disappears.
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // The PiP canvas composites whatever is on screen: focused tile + this page.
  // Written in an effect (not during render) so concurrent/discarded renders
  // can't leave the ref holding tracks from an abandoned render.
  useEffect(() => {
    pipTracksRef.current = focusedTrack ? [focusedTrack, ...visibleTracks] : visibleTracks;
  }, [focusedTrack, visibleTracks]);

  const tileCount = visibleTracks.length || 1;
  const cols = hasFocus ? 1 : tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 9 ? 3 : 4;
  const rows = hasFocus ? tileCount : Math.ceil(tileCount / cols);

  const getParticipantLabel = (p: { identity: string; isLocal: boolean }) =>
    participantNames.current.get(p.identity) ?? (p.isLocal ? 'You' : p.identity.slice(0, 8));

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
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
            }}
            placeholder="Your display name"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--cm-chrome-hover)',
              background: 'var(--cm-surface-button)',
              color: 'var(--cm-chrome-text)',
              fontSize: 'var(--cm-text-base)',
              outline: 'none',
            }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={styles.controlBtn}
              onClick={handleNameSubmit}
              style={{ flex: 1, borderRadius: 6, width: 'auto', height: 28 }}
            >
              Join
            </button>
            <button
              className={styles.controlBtn}
              onClick={() => {
                setDisplayName('Anonymous');
                setShowNamePrompt(false);
              }}
              style={{ flex: 1, borderRadius: 6, width: 'auto', height: 28, opacity: 0.6 }}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ──
  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ ...posStyle, ...sizeStyle }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Resize handles */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((dir) => (
        <div
          key={dir}
          className={`${styles.resizeHandle} ${styles[`resize${dir.toUpperCase()}` as keyof typeof styles]}`}
          onPointerDown={(e) => {
            onResizeStart(dir, e);
          }}
        />
      ))}

      {/* Header */}
      <div
        className={styles.header}
        onPointerDown={onDragStart}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <span className={styles.headerIdentity}>
          <Users size={14} style={{ marginRight: 4, display: 'inline' }} />
          {t('videoCall.groupCall', { defaultValue: 'Group Call' })} ({participants.length})
        </span>
        {meetCode && (
          <div
            style={{ position: 'relative' }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              onClick={() => {
                setShowShareMenu((v) => !v);
              }}
              title={codeCopied ? 'Copied!' : 'Share meeting'}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--cm-text-sm)',
                opacity: 0.8,
                padding: '0 4px',
              }}
            >
              <span style={{ fontFamily: 'monospace' }}>{meetCode}</span>
              {codeCopied ? <Check size={12} /> : <Share2 size={12} />}
            </button>
            {showShareMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: 'var(--cm-titlebar)',
                  border: '1px solid var(--cm-chrome-hover)',
                  borderRadius: 8,
                  padding: 4,
                  minWidth: 180,
                  zIndex: 20,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              >
                <button
                  onClick={copyMeetCode}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 10px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--cm-chrome-text)',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 'var(--cm-text-sm)',
                    textAlign: 'left',
                  }}
                >
                  <Copy size={14} /> Copy link
                </button>
                <button
                  onClick={shareViaEmail}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 10px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--cm-chrome-text)',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 'var(--cm-text-sm)',
                    textAlign: 'left',
                  }}
                >
                  <Mail size={14} /> Share via email
                </button>
                <button
                  onClick={shareViaBluesky}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 10px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--cm-chrome-text)',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 'var(--cm-text-sm)',
                    textAlign: 'left',
                  }}
                >
                  <ExternalLink size={14} /> Share via Bluesky
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className={styles.headerHangUp}
          onClick={handleLeave}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title={t('videoCall.endCall')}
          aria-label={t('videoCall.endCall')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Video + Chat row */}
      <div style={{ display: 'flex', flex: 1, minHeight: 200, overflow: 'hidden' }}>
        {/* Video area */}
        <div
          className={styles.videosContainer}
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: hasFocus ? 'row' : undefined,
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* Focused tile (large) */}
          {focusedTrack && (
            <div
              style={{
                flex: 3,
                position: 'relative',
                overflow: 'hidden',
                background: '#1a1a2e',
                cursor: 'pointer',
                minHeight: 0,
              }}
              onClick={() => {
                setPinnedKey(null);
              }}
              title="Click to unpin"
            >
              {focusedTrack.publication?.track ? (
                <VideoTrack
                  trackRef={focusedTrack}
                  ref={(el: HTMLVideoElement | null) => {
                    const key = trackKey(focusedTrack);
                    if (el) tileVideoRefs.current.set(key, el);
                    else tileVideoRefs.current.delete(key);
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: focusedTrack.participant.isLocal ? 'scaleX(-1)' : undefined,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{ color: 'rgba(255,255,255,0.5)', fontSize: '2rem', fontWeight: 700 }}
                  >
                    {getParticipantLabel(focusedTrack.participant)}
                  </span>
                </div>
              )}
              <span
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 8,
                  color: '#fff',
                  fontSize: '0.7rem',
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                }}
              >
                {getParticipantLabel(focusedTrack.participant)}
              </span>
              {focusedTrack.participant.sid === activeSpeakerSid && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: '2px solid var(--color-success)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )}

          {/* Other tiles (grid or strip) */}
          <div
            style={{
              flex: hasFocus ? 1 : undefined,
              display: hasFocus ? 'flex' : 'grid',
              flexDirection: hasFocus ? 'column' : undefined,
              gridTemplateColumns: hasFocus ? undefined : `repeat(${cols}, 1fr)`,
              gridTemplateRows: hasFocus ? undefined : `repeat(${rows}, 1fr)`,
              gap: 2,
              minHeight: hasFocus ? undefined : 0,
              ...(hasFocus ? {} : { flex: 1 }),
            }}
          >
            {visibleTracks.map((trackRef) => {
              const hasVideo = !!trackRef.publication?.track;
              const isLocal = trackRef.participant.isLocal;
              const sid = trackRef.participant.sid;
              const isSpeaking = sid === activeSpeakerSid;

              return (
                <div
                  key={sid + '-' + trackRef.source}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    background: '#1a1a2e',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flex: hasFocus ? 1 : undefined,
                    minHeight: hasFocus ? 0 : undefined,
                    border: isSpeaking ? '2px solid var(--color-success)' : '2px solid transparent',
                  }}
                  onClick={() => {
                    const key = trackKey(trackRef);
                    setPinnedKey(key === pinnedKey ? null : key);
                  }}
                  title="Click to focus"
                >
                  {hasVideo ? (
                    <VideoTrack
                      trackRef={trackRef as TrackReference}
                      ref={(el: HTMLVideoElement | null) => {
                        const key = trackKey(trackRef);
                        if (el) tileVideoRefs.current.set(key, el);
                        else tileVideoRefs.current.delete(key);
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: isLocal ? 'scaleX(-1)' : undefined,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: hasFocus ? '0.9rem' : '1.5rem',
                        fontWeight: 700,
                      }}
                    >
                      {getParticipantLabel(trackRef.participant)}
                    </span>
                  )}
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      left: 4,
                      color: '#fff',
                      fontSize: '0.6rem',
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    }}
                  >
                    {getParticipantLabel(trackRef.participant)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Floating emoji overlay */}
          <FloatingEmojiOverlay emojis={floatingEmojis} />

          {/* Hidden PiP video */}
          <video
            ref={displayVideoRef}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            autoPlay
            playsInline
            muted
          />
          <RemoteAudioTracks />
        </div>

        {/* Chat panel (right side) */}
        {chatOpen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 220,
              borderLeft: '1px solid var(--cm-chrome-hover)',
              background: 'var(--cm-titlebar)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 8px',
                fontSize: 'var(--cm-text-sm)',
              }}
            >
              {chatMessages.length === 0 && (
                <p style={{ opacity: 0.4, textAlign: 'center', padding: 8 }}>No messages yet</p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} style={{ marginBottom: 2, wordBreak: 'break-word' }}>
                  <strong style={{ color: 'var(--color-primary)', marginRight: 4 }}>
                    {m.sender === localParticipant.identity ? 'You' : m.senderName}:
                  </strong>
                  <span style={{ color: 'var(--cm-chrome-text)' }}>{m.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: '4px 8px',
                borderTop: '1px solid var(--cm-chrome-hover)',
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChat();
                }}
                placeholder="Message..."
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--cm-chrome-hover)',
                  background: 'var(--cm-surface-button)',
                  color: 'var(--cm-chrome-text)',
                  fontSize: 'var(--cm-text-sm)',
                  outline: 'none',
                  minWidth: 0,
                }}
              />
              <button
                className={styles.controlBtn}
                onClick={sendChat}
                style={{ width: 28, height: 28 }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
      {/* End Video + Chat row */}

      {/* Pagination */}
      {pageCount > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '4px 8px',
            background: 'var(--cm-titlebar)',
            borderTop: '1px solid var(--cm-chrome-hover)',
            fontSize: 'var(--cm-text-sm)',
            color: 'var(--cm-chrome-text)',
          }}
        >
          <button
            className={styles.controlBtn}
            onClick={() => {
              setPage((p) => Math.max(0, p - 1));
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            disabled={safePage === 0}
            aria-label={t('videoCall.prevPage', { defaultValue: 'Previous page' })}
            style={{ width: 28, height: 28, opacity: safePage === 0 ? 0.4 : 1 }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontFamily: 'monospace' }} aria-live="polite">
            {safePage + 1} / {pageCount}
          </span>
          <button
            className={styles.controlBtn}
            onClick={() => {
              setPage((p) => Math.min(pageCount - 1, p + 1));
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            disabled={safePage === pageCount - 1}
            aria-label={t('videoCall.nextPage', { defaultValue: 'Next page' })}
            style={{ width: 28, height: 28, opacity: safePage === pageCount - 1 ? 0.4 : 1 }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Emoji picker (popover above control bar) */}
      {showEmojiPicker && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '4px 8px',
            justifyContent: 'center',
            background: 'var(--cm-titlebar)',
            borderTop: '1px solid var(--cm-chrome-hover)',
          }}
        >
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                sendEmoji(emoji);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.2rem',
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Control bar */}
      <div className={styles.controlBar}>
        <button
          className={`${styles.controlBtn} ${isMuted ? styles.controlBtnActive : ''}`}
          onClick={() => {
            void toggleMute();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title={isMuted ? t('videoCall.unmute') : t('videoCall.mute')}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          className={`${styles.controlBtn} ${isCameraOff ? styles.controlBtnActive : ''}`}
          onClick={() => {
            void toggleCamera();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title={isCameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
        >
          {isCameraOff ? <VideoOff size={16} /> : <Video size={16} />}
        </button>
        {'getDisplayMedia' in navigator.mediaDevices && (
          <button
            className={`${styles.controlBtn} ${isScreenSharing ? styles.controlBtnActive : ''}`}
            onClick={() => {
              void toggleScreenShare();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title={isScreenSharing ? t('videoCall.stopSharing') : t('videoCall.shareScreen')}
          >
            {isScreenSharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />}
          </button>
        )}
        <button
          className={`${styles.controlBtn} ${showEmojiPicker ? styles.controlBtnActive : ''}`}
          onClick={() => {
            setShowEmojiPicker((v) => !v);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title="Reactions"
        >
          <Smile size={16} />
        </button>
        <button
          className={`${styles.controlBtn} ${chatOpen ? styles.controlBtnActive : ''}`}
          onClick={toggleChat}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title="Chat"
          style={{ position: 'relative' }}
        >
          <MessageSquare size={16} />
          {unreadCount > 0 && !chatOpen && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--color-error)',
                color: '#fff',
                fontSize: '0.6rem',
                borderRadius: '50%',
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {document.pictureInPictureEnabled && (
          <button
            className={styles.controlBtn}
            onClick={() => {
              displayVideoRef.current?.requestPictureInPicture().catch(() => {});
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title="Picture-in-Picture"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        <button
          className={`${styles.controlBtn} ${styles.hangUpBtn}`}
          onClick={handleLeave}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title={t('videoCall.endCall')}
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </div>
  );
}

export function GroupCallOverlay() {
  const { activeGroupCall, leaveGroupCall } = useGroupCall();

  if (!activeGroupCall) return null;

  const { token, url, meetCode } = activeGroupCall;

  return (
    <>
      {/* CSS for floating emoji animation */}
      <style>{`
        @keyframes groupCallEmojiFloat {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-300px) scale(1.5); opacity: 0; }
        }
      `}</style>
      <LiveKitRoom
        token={token}
        serverUrl={url}
        options={ROOM_OPTIONS}
        connect={true}
        audio={false}
        video={false}
        onDisconnected={() => {
          leaveGroupCall();
        }}
      >
        <GroupCallInner onLeave={leaveGroupCall} meetCode={meetCode} />
      </LiveKitRoom>
    </>
  );
}
