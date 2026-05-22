import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic,
  MicOff,
  MessageSquare,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  Smile,
  Video,
  VideoOff,
} from 'lucide-react';
import type { LocalParticipant } from 'livekit-client';
import { EMOJI_OPTIONS } from './types';
import styles from '../VideoCallOverlay.module.css';

interface ControlBarProps {
  localParticipant: LocalParticipant;
  chatOpen: boolean;
  unreadCount: number;
  onToggleChat: () => void;
  onSendEmoji: (emoji: string) => void;
  onRequestPip: () => void;
  onLeave: () => void;
}

/** Bottom control bar. Owns local media state and the emoji picker popover. */
export const ControlBar = memo(function ControlBar({
  localParticipant,
  chatOpen,
  unreadCount,
  onToggleChat,
  onSendEmoji,
  onRequestPip,
  onLeave,
}: ControlBarProps) {
  const { t } = useTranslation('common');
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

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

  const screenShareSupported = 'getDisplayMedia' in navigator.mediaDevices;
  const pipSupported = document.pictureInPictureEnabled;

  const stopDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Emoji picker (popover above the control bar) */}
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
                onSendEmoji(emoji);
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

      <div className={styles.controlBar}>
        <button
          className={`${styles.controlBtn} ${isMuted ? styles.controlBtnActive : ''}`}
          onClick={() => {
            void toggleMute();
          }}
          onPointerDown={stopDrag}
          title={isMuted ? t('videoCall.unmute') : t('videoCall.mute')}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          className={`${styles.controlBtn} ${isCameraOff ? styles.controlBtnActive : ''}`}
          onClick={() => {
            void toggleCamera();
          }}
          onPointerDown={stopDrag}
          title={isCameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
        >
          {isCameraOff ? <VideoOff size={16} /> : <Video size={16} />}
        </button>
        {screenShareSupported && (
          <button
            className={`${styles.controlBtn} ${isScreenSharing ? styles.controlBtnActive : ''}`}
            onClick={() => {
              void toggleScreenShare();
            }}
            onPointerDown={stopDrag}
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
          onPointerDown={stopDrag}
          title="Reactions"
        >
          <Smile size={16} />
        </button>
        <button
          className={`${styles.controlBtn} ${chatOpen ? styles.controlBtnActive : ''}`}
          onClick={onToggleChat}
          onPointerDown={stopDrag}
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
        {pipSupported && (
          <button
            className={styles.controlBtn}
            onClick={onRequestPip}
            onPointerDown={stopDrag}
            title="Picture-in-Picture"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        <button
          className={`${styles.controlBtn} ${styles.hangUpBtn}`}
          onClick={onLeave}
          onPointerDown={stopDrag}
          title={t('videoCall.endCall')}
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </>
  );
});
