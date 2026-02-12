import { useState, useRef, useEffect } from 'react';
import styles from './VideoPlayer.module.css';

interface VideoPlayerProps {
  playlist: string;
  thumbnail?: string;
}

export function VideoPlayer({ playlist, thumbnail }: VideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  // Set up HLS once the <video> element has mounted (playing === true)
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;

    // Safari supports HLS natively
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlist;
      void video.play();
      return;
    }

    let cancelled = false;

    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;

      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(playlist);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play();
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [playing, playlist]);

  if (!playing) {
    return (
      <div
        className={styles.poster}
        role="button"
        tabIndex={0}
        aria-label="Play video"
        onClick={() => {
          setPlaying(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPlaying(true);
          }
        }}
      >
        {thumbnail && <img className={styles.posterImg} src={thumbnail} alt="" loading="lazy" />}
        <span className={styles.playIcon} aria-hidden="true">
          &#9654;
        </span>
      </div>
    );
  }

  return (
    <div className={styles.playerWrap}>
      <video ref={videoRef} className={styles.video} controls playsInline />
    </div>
  );
}
