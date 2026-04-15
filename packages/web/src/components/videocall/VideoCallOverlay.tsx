import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Phone,
  PhoneOff,
  MicOff,
  Mic,
  VideoOff,
  Video,
  MonitorUp,
  RotateCcw,
  SwitchCamera,
  X,
  PictureInPicture2,
} from 'lucide-react';
import { useVideoCall } from '../../contexts/VideoCallContext';
import { useAuth } from '../../hooks/useAuth';
import { useProfile } from '../../contexts/ProfileContext';
import { useDragResize } from '../../hooks/useDragResize';
import { UserIdentity } from '../chat/UserIdentity';
import styles from './VideoCallOverlay.module.css';

export function VideoCallOverlay() {
  const { t } = useTranslation('common');
  const {
    activeCall,
    callError,
    isMuted,
    isCameraOff,
    isScreenSharing,
    acceptCall,
    rejectCall,
    hangUp,
    retryCall,
    toggleMute,
    toggleCamera,
    flipCamera,
    startScreenShare,
    stopScreenShare,
  } = useVideoCall();

  const {
    containerRef,
    posStyle,
    sizeStyle,
    onDragStart,
    onPointerMove,
    onPointerUp,
    onResizeStart,
    reset,
  } = useDragResize({ minWidth: 240, minHeight: 180 });

  const { did } = useAuth();
  const myProfile = useProfile(did);
  const isCameraOffRef = useRef(isCameraOff);
  isCameraOffRef.current = isCameraOff;

  // Display initials for camera-off (can't draw external images on captureStream canvas — CORS taints it)
  const myInitialRef = useRef('?');
  const myChar = myProfile?.handle[0];
  myInitialRef.current = myChar ? myChar.toUpperCase() : '?';

  const remoteProfile = useProfile(activeCall?.recipientDid);
  const remoteInitialRef = useRef('?');
  const remoteChar = remoteProfile?.handle[0];
  remoteInitialRef.current = remoteChar ? remoteChar.toUpperCase() : '?';

  // Track whether remote camera is muted (track.muted fires when sender disables their video)
  const isRemoteCameraOff = useRef(false);
  useEffect(() => {
    const stream = activeCall?.remoteStream;
    if (!stream) {
      isRemoteCameraOff.current = false;
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    isRemoteCameraOff.current = videoTrack.muted;

    const onMute = () => {
      isRemoteCameraOff.current = true;
    };
    const onUnmute = () => {
      isRemoteCameraOff.current = false;
    };
    videoTrack.addEventListener('mute', onMute);
    videoTrack.addEventListener('unmute', onUnmute);
    return () => {
      videoTrack.removeEventListener('mute', onMute);
      videoTrack.removeEventListener('unmute', onUnmute);
    };
  }, [activeCall?.remoteStream]);

  // Reset position/size when a new call starts
  useEffect(() => {
    if (activeCall) {
      reset();
    }
  }, [activeCall?.conversationId]);

  // --- Google Meet approach: the visible video plays a canvas composite stream.
  // Raw streams play on hidden source elements that feed the canvas.
  // This way auto-PiP on tab switch naturally shows both streams. ---

  // Hidden source refs — feed the canvas compositor
  const remoteSrcRef = useRef<HTMLVideoElement | null>(null);
  const localSrcRef = useRef<HTMLVideoElement | null>(null);

  const remoteSourceRef = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteSrcRef.current = el;
      if (el && activeCall?.remoteStream) {
        el.srcObject = activeCall.remoteStream;
        el.play().catch(() => {});
      }
    },
    [activeCall?.remoteStream],
  );

  const localSourceRef = useCallback(
    (el: HTMLVideoElement | null) => {
      localSrcRef.current = el;
      if (el && activeCall?.localStream) {
        el.srcObject = activeCall.localStream;
        el.play().catch(() => {});
      }
    },
    [activeCall?.localStream],
  );

  // Display video — plays the canvas composite, gets PiP'd
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Canvas compositor: remote full-frame + local mirrored inset → display video
  useEffect(() => {
    if (activeCall?.status !== 'active') return;

    const display = displayVideoRef.current;
    const remote = remoteSrcRef.current;
    if (!display || !remote) return;

    if (!pipCanvasRef.current) {
      pipCanvasRef.current = document.createElement('canvas');
    }
    const canvas = pipCanvasRef.current;
    const W = 640;
    const H = 480;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    display.srcObject = canvas.captureStream(30);
    display.play().catch(() => {});

    let frameId: number;
    const draw = () => {
      if (isRemoteCameraOff.current || remote.readyState < 2) {
        // Remote camera off or not ready — dark background with initial
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `bold ${Math.round(H * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(remoteInitialRef.current, W / 2, H / 2);
      } else {
        // Preserve remote video aspect ratio (phone sends portrait, screen sends landscape)
        const vw = remote.videoWidth || W;
        const vh = remote.videoHeight || H;
        const scale = Math.min(W / vw, H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(remote, dx, dy, dw, dh);
      }

      // Local inset only drawn on canvas for PiP (DOM overlay handles in-page view)
      if (document.pictureInPictureElement === display) {
        const pw = Math.round(W * 0.25);
        const ph = Math.round(H * 0.25);
        const pad = 8;
        const lx = W - pw - pad;
        const ly = H - ph - pad;

        if (isCameraOffRef.current) {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(lx, ly, pw, ph);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = `bold ${Math.round(ph * 0.4)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(myInitialRef.current, lx + pw / 2, ly + ph / 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(lx, ly, pw, ph);
        } else {
          const local = localSrcRef.current;
          if (local && local.readyState >= 2) {
            ctx.save();
            ctx.translate(lx + pw, ly);
            ctx.scale(-1, 1);
            ctx.drawImage(local, 0, 0, pw, ph);
            ctx.restore();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(lx, ly, pw, ph);
          }
        }
      }

      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
      if (document.pictureInPictureElement === display) {
        document.exitPictureInPicture().catch(() => {});
      }
      display.srcObject = null;
    };
  }, [activeCall?.status]);

  // Auto Picture-in-Picture when user switches tabs.
  // Works because the display video IS the composite — no swapping needed.
  useEffect(() => {
    if (activeCall?.status !== 'active') return;

    const onVisibilityChange = () => {
      const video = displayVideoRef.current;
      if (!video || !document.pictureInPictureEnabled) return;

      if (document.hidden) {
        if (!document.pictureInPictureElement) {
          video.requestPictureInPicture().catch(() => {});
        }
      } else {
        if (document.pictureInPictureElement === video) {
          document.exitPictureInPicture().catch(() => {});
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeCall?.status]);

  // Show error banner even without an active call (e.g. getUserMedia denied)
  if (!activeCall) {
    if (callError) {
      return (
        <div className={styles.errorBanner} role="alert">
          {t(callError, { defaultValue: callError })}
        </div>
      );
    }
    return null;
  }

  // Incoming call — top-center banner
  if (activeCall.status === 'incoming') {
    return (
      <div
        className={styles.incomingBanner}
        role="alert"
        aria-label={t('videoCall.incoming.ariaLabel')}
      >
        <span className={styles.bannerIdentity}>
          <UserIdentity did={activeCall.recipientDid} showAvatar size="sm" />
        </span>
        <span className={styles.bannerLabel}>{t('videoCall.incoming.label')}</span>
        <div className={styles.bannerActions}>
          <button
            className={styles.acceptBtn}
            onClick={() => {
              void acceptCall();
            }}
            title={t('videoCall.incoming.accept')}
            aria-label={t('videoCall.incoming.acceptAriaLabel')}
          >
            <Phone size={16} />
          </button>
          <button
            className={styles.rejectBtn}
            onClick={rejectCall}
            title={t('videoCall.incoming.reject')}
            aria-label={t('videoCall.incoming.rejectAriaLabel')}
          >
            <PhoneOff size={16} />
          </button>
        </div>
      </div>
    );
  }

  // Outgoing (ringing) or active call — draggable, resizable floating panel
  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ ...posStyle, ...sizeStyle }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Resize handles — 8 edges/corners */}
      <div
        className={`${styles.resizeHandle} ${styles.resizeN}`}
        onPointerDown={(e) => {
          onResizeStart('n', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeS}`}
        onPointerDown={(e) => {
          onResizeStart('s', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeE}`}
        onPointerDown={(e) => {
          onResizeStart('e', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeW}`}
        onPointerDown={(e) => {
          onResizeStart('w', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeNE}`}
        onPointerDown={(e) => {
          onResizeStart('ne', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeNW}`}
        onPointerDown={(e) => {
          onResizeStart('nw', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeSE}`}
        onPointerDown={(e) => {
          onResizeStart('se', e);
        }}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeSW}`}
        onPointerDown={(e) => {
          onResizeStart('sw', e);
        }}
        title={t('videoCall.dragToResize', { defaultValue: 'Drag to resize' })}
      />

      <div
        className={styles.header}
        onPointerDown={onDragStart}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <span className={styles.headerIdentity}>
          <UserIdentity did={activeCall.recipientDid} showAvatar size="sm" />
        </span>
        {activeCall.status === 'outgoing' && (
          <span className={styles.headerStatus}>{t('videoCall.calling')}</span>
        )}
        {activeCall.status === 'reconnecting' && (
          <span className={styles.headerStatus}>{t('videoCall.reconnecting')}</span>
        )}
        <button
          className={styles.headerHangUp}
          onClick={hangUp}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          title={t('videoCall.endCall')}
          aria-label={t('videoCall.endCall')}
        >
          <X size={16} />
        </button>
      </div>

      {activeCall.status === 'outgoing' && (
        <div className={styles.ringing}>
          <p>{t('videoCall.ringing')}</p>
        </div>
      )}

      {activeCall.status === 'failed' && (
        <div className={styles.failedBody}>
          <p className={styles.failedText}>{t('videoCall.connectionFailed')}</p>
          <button
            className={styles.acceptBtn}
            onClick={retryCall}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title={t('videoCall.retry')}
            aria-label={t('videoCall.retry')}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      )}

      {(activeCall.status === 'active' || activeCall.status === 'reconnecting') && (
        <div className={styles.videosContainer}>
          {/* Hidden source videos — feed the canvas compositor */}
          <video ref={remoteSourceRef} className={styles.hiddenSource} autoPlay playsInline />
          <video ref={localSourceRef} className={styles.hiddenSource} autoPlay playsInline muted />

          {/* Display video — plays canvas composite (remote + local inset) */}
          <video
            ref={displayVideoRef}
            className={styles.remoteVideo}
            aria-label="Video call"
            autoPlay
            playsInline
            muted
          />

          {/* Local video overlay — positioned via CSS, independent of canvas */}
          {activeCall.localStream && (
            <video
              ref={(el) => {
                if (el && el.srcObject !== activeCall.localStream) {
                  el.srcObject = activeCall.localStream;
                  el.play().catch(() => {});
                }
              }}
              className={`${styles.localVideo} ${isCameraOff ? styles.localVideoHidden : ''}`}
              autoPlay
              playsInline
              muted
            />
          )}

          {isCameraOff && <div className={styles.localVideoOff}>{myInitialRef.current}</div>}

          {activeCall.status === 'reconnecting' && (
            <div className={styles.reconnectingOverlay}>{t('videoCall.reconnecting')}</div>
          )}
        </div>
      )}

      {(activeCall.status === 'active' || activeCall.status === 'reconnecting') && (
        <div className={styles.controlBar}>
          <button
            className={`${styles.controlBtn} ${isMuted ? styles.controlBtnActive : ''}`}
            onClick={toggleMute}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            aria-pressed={isMuted}
            title={isMuted ? t('videoCall.unmute') : t('videoCall.mute')}
            aria-label={isMuted ? t('videoCall.unmute') : t('videoCall.mute')}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            className={`${styles.controlBtn} ${isCameraOff ? styles.controlBtnActive : ''}`}
            onClick={toggleCamera}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            aria-pressed={isCameraOff}
            title={isCameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
            aria-label={isCameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
          >
            {isCameraOff ? <VideoOff size={16} /> : <Video size={16} />}
          </button>
          {'getDisplayMedia' in navigator.mediaDevices && (
            <button
              className={`${styles.controlBtn} ${isScreenSharing ? styles.controlBtnActive : ''}`}
              onClick={() => {
                void (isScreenSharing ? stopScreenShare() : startScreenShare());
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              aria-pressed={isScreenSharing}
              title={isScreenSharing ? t('videoCall.stopSharing') : t('videoCall.shareScreen')}
              aria-label={isScreenSharing ? t('videoCall.stopSharing') : t('videoCall.shareScreen')}
            >
              <MonitorUp size={16} />
            </button>
          )}
          <button
            className={`${styles.controlBtn} ${styles.flipBtn}`}
            onClick={() => {
              void flipCamera();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title={t('videoCall.flipCamera')}
            aria-label={t('videoCall.flipCamera')}
          >
            <SwitchCamera size={16} />
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
              title={t('videoCall.pictureInPicture', {
                defaultValue: 'Picture-in-Picture',
              })}
              aria-label={t('videoCall.pictureInPicture', {
                defaultValue: 'Picture-in-Picture',
              })}
            >
              <PictureInPicture2 size={16} />
            </button>
          )}
          <button
            className={`${styles.controlBtn} ${styles.hangUpBtn}`}
            onClick={hangUp}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            title={t('videoCall.endCall')}
            aria-label={t('videoCall.endCall')}
          >
            <PhoneOff size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
