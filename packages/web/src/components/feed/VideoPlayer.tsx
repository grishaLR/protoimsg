import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Volume2, VolumeOff, Maximize, RotateCcw, Loader2 } from 'lucide-react';
import { useActiveVideo } from '../../contexts/ActiveVideoContext';
import { useVideoVolume } from '../../contexts/VideoVolumeContext';
import { getBandwidthEstimate, setBandwidthEstimate } from '../../lib/bandwidth-estimate';
import styles from './VideoPlayer.module.css';

interface VideoPlayerProps {
  playlist: string;
  thumbnail?: string;
  aspectRatio?: { width: number; height: number };
  alt?: string;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error';

// Cache the hls.js dynamic import so it only runs once across all instances
let hlsPromise: Promise<typeof import('hls.js')> | undefined;
function loadHls() {
  if (!hlsPromise) hlsPromise = import('hls.js');
  return hlsPromise;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Track whether the container is at least 50% visible in the viewport. */
function useVideoVisibility(containerRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  return isVisible;
}

export function VideoPlayer({ playlist, thumbnail, aspectRatio, alt }: VideoPlayerProps) {
  const { t } = useTranslation('feed');
  const [state, setState] = useState<PlayerState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const { muted, volume, setMuted } = useVideoVolume();
  const { requestActive, releaseActive, onPauseRequest } = useActiveVideo();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void; bandwidthEstimate?: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const stateRef = useRef<PlayerState>(state);
  stateRef.current = state;

  const isVisible = useVideoVisibility(containerRef);

  // CSS aspect-ratio for stable sizing; max-height in CSS caps tall portrait videos
  const cssAspectRatio = aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : undefined;

  // Background image style for zero layout shift during thumbnail→video transition
  const aspectBoxStyle: React.CSSProperties = {
    ...(cssAspectRatio ? { aspectRatio: cssAspectRatio } : {}),
    ...(thumbnail ? { backgroundImage: `url(${thumbnail})` } : {}),
  };

  // Register pause callback from ActiveVideoContext
  useEffect(() => {
    return onPauseRequest(playlist, () => {
      const video = videoRef.current;
      if (video && stateRef.current === 'playing') {
        video.pause();
        setState('paused');
      }
    });
  }, [playlist, onPauseRequest]);

  // Off-screen pause: if video is playing and scrolls out of view, pause it
  useEffect(() => {
    if (!isVisible && (state === 'playing' || state === 'buffering')) {
      // Don't pause if in fullscreen
      if (document.fullscreenElement === containerRef.current) return;
      const video = videoRef.current;
      if (video) {
        video.pause();
        setState('paused');
        releaseActive(playlist);
      }
    }
  }, [isVisible, state, playlist, releaseActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseActive(playlist);
    };
  }, [playlist, releaseActive]);

  const startPlayback = useCallback(() => {
    if (state === 'loading' || state === 'playing') return;
    requestActive(playlist);
    setState('loading');
  }, [state, playlist, requestActive]);

  // Set up HLS when entering loading state
  useEffect(() => {
    if (state !== 'loading') return;
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    video.volume = volume;

    // Safari supports HLS natively
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlist;
      video
        .play()
        .then(() => {
          setState('playing');
        })
        .catch(() => {
          setState('error');
        });
      return;
    }

    let cancelled = false;

    void loadHls().then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setState('error');
        return;
      }

      const bwEstimate = getBandwidthEstimate();
      const hls = new Hls({
        maxMaxBufferLength: 10,
        ...(bwEstimate !== undefined ? { abrEwmaDefaultEstimate: bwEstimate } : {}),
      });
      hlsRef.current = hls;
      hls.loadSource(playlist);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        video
          .play()
          .then(() => {
            setState('playing');
          })
          .catch(() => {
            setState('error');
          });
      });

      // Track bandwidth from fragment loads
      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (cancelled) return;
        setBandwidthEstimate(hls.bandwidthEstimate);
      });

      // Flush low-quality segments once higher quality is available
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        if (cancelled) return;
        const frag = data.frag;
        if (frag.level === 0 && hls.nextAutoLevel > 0) {
          // Don't flush the segment the playhead is currently inside
          if (video.currentTime >= frag.start && video.currentTime < frag.start + frag.duration) {
            return;
          }
          hls.trigger(Hls.Events.BUFFER_FLUSHING, {
            startOffset: frag.start,
            endOffset: frag.start + frag.duration,
            type: 'video',
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled) return;
        if (data.fatal) setState('error');
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [state, playlist, muted, volume]);

  // Track time + duration + buffering detection
  useEffect(() => {
    const video = videoRef.current;
    if (!video || state === 'idle') return;

    const onTime = () => {
      if (!isScrubbing) setCurrentTime(video.currentTime);
      // Clear buffering if we're getting timeupdate events
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      if (stateRef.current === 'buffering') setState('playing');
    };
    const onDuration = () => {
      setDuration(video.duration);
    };
    const onEnded = () => {
      setState('paused');
      releaseActive(playlist);
    };
    const onPlaying = () => {
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      if (stateRef.current === 'buffering') setState('playing');
    };
    const onWaiting = () => {
      // Only show buffering spinner after a brief delay to avoid flicker
      if (stateRef.current === 'playing' && !bufferTimerRef.current) {
        bufferTimerRef.current = setTimeout(() => {
          bufferTimerRef.current = null;
          if (stateRef.current === 'playing') setState('buffering');
        }, 500);
      }
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('ended', onEnded);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
    };
  }, [state, isScrubbing, playlist, releaseActive]);

  // Sync muted/volume to video element when context changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [muted, volume]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (state === 'playing' || state === 'buffering') {
      video.pause();
      setState('paused');
      releaseActive(playlist);
    } else if (state === 'paused') {
      requestActive(playlist);
      void video.play().then(() => {
        setState('playing');
      });
    }
  }, [state, playlist, requestActive, releaseActive]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(time, video.duration || 0));
    setCurrentTime(video.currentTime);
  }, []);

  // Auto-hide controls after 3s of no movement
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (state === 'playing' || state === 'buffering') {
      controlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (state === 'idle' || state === 'loading') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(currentTime + 5);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    },
    [state, togglePlay, seek, currentTime, toggleMute, toggleFullscreen],
  );

  // Scrubber interaction
  const handleScrubStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      setIsScrubbing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek],
  );

  const handleScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbing || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [isScrubbing, duration, seek],
  );

  const handleScrubEnd = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  const retry = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    requestActive(playlist);
    setState('loading');
  }, [playlist, requestActive]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isActive = state !== 'idle';
  const isPlayingLike = state === 'playing' || state === 'buffering';
  const showControlBar = isPlayingLike || state === 'paused';

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseMove={isActive ? resetControlsTimer : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={isActive ? 0 : undefined}
    >
      {/* Aspect ratio box — keeps height stable, background-image avoids flash */}
      <div className={styles.aspectBox} style={aspectBoxStyle}>
        {/* Video element is always in DOM; HLS only attaches when loading */}
        <video
          ref={videoRef}
          className={`${styles.video} ${!isActive ? styles.videoHidden : ''}`}
          playsInline
          muted={muted}
          poster={thumbnail}
        />

        {/* ── Overlays ─────────────────────────── */}

        {/* Idle state — big play button */}
        {state === 'idle' && (
          <button
            className={styles.bigPlayButton}
            onClick={startPlayback}
            type="button"
            aria-label={t('video.play')}
          >
            <Play size={32} fill="currentColor" />
          </button>
        )}

        {/* Loading spinner */}
        {state === 'loading' && (
          <div className={styles.overlay}>
            <Loader2 size={32} className={styles.spinner} />
          </div>
        )}

        {/* Buffering spinner (non-interactive, on top of video) */}
        {state === 'buffering' && (
          <div className={styles.bufferingOverlay} aria-label={t('video.buffering')}>
            <Loader2 size={32} className={styles.spinner} />
          </div>
        )}

        {/* Error state */}
        {state === 'error' && (
          <div className={styles.overlay}>
            <button className={styles.retryButton} onClick={retry} type="button">
              <RotateCcw size={16} />
              {t('video.retry')}
            </button>
          </div>
        )}

        {/* Play/pause tap area (playing, buffering, or paused) */}
        {showControlBar && (
          <button
            className={`${styles.tapArea} ${showControls ? styles.tapAreaVisible : ''}`}
            onClick={() => {
              togglePlay();
              resetControlsTimer();
            }}
            type="button"
            aria-label={isPlayingLike ? t('video.pause') : t('video.play')}
          >
            {state === 'paused' && (
              <div className={styles.bigPlayIcon}>
                <Play size={32} fill="currentColor" />
              </div>
            )}
          </button>
        )}

        {/* Control bar */}
        {showControlBar && (
          <div
            className={`${styles.controlBar} ${showControls || state === 'paused' ? styles.controlBarVisible : ''}`}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {/* Scrubber */}
            <div
              className={styles.scrubber}
              onPointerDown={handleScrubStart}
              onPointerMove={handleScrubMove}
              onPointerUp={handleScrubEnd}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label={t('video.scrubber')}
            >
              <div className={styles.scrubberTrack}>
                <div className={styles.scrubberFill} style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className={styles.controlRow}>
              <button
                className={styles.controlButton}
                onClick={() => {
                  togglePlay();
                  resetControlsTimer();
                }}
                type="button"
                aria-label={isPlayingLike ? t('video.pause') : t('video.play')}
              >
                {isPlayingLike ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
              </button>

              <button
                className={styles.controlButton}
                onClick={toggleMute}
                type="button"
                aria-label={muted ? t('video.unmute') : t('video.mute')}
              >
                {muted ? <VolumeOff size={14} /> : <Volume2 size={14} />}
              </button>

              <span className={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className={styles.controlSpacer} />

              <button
                className={styles.controlButton}
                onClick={toggleFullscreen}
                type="button"
                aria-label={t('video.fullscreen')}
              >
                <Maximize size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Alt text label */}
      {alt && state === 'idle' && <div className={styles.altLabel}>{t('video.altAvailable')}</div>}
    </div>
  );
}
