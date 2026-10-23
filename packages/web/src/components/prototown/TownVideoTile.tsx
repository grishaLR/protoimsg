import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProximityVideo } from '../../town/ProximityVoice';
import { resolveDisplayNameForDid } from '../../lib/resolve-pds';
import styles from './ProtoTownPanel.module.css';

interface TownVideoTileProps {
  video: ProximityVideo;
  /**
   * Other people's video starts hidden — nobody can flash video at you just
   * by walking up. A hidden feed isn't even attached to a <video> element.
   */
  revealed: boolean;
  onToggleReveal: (key: string) => void;
}

/** One camera feed in a proximity conversation. Your own is mirrored. */
export function TownVideoTile({ video, revealed, onToggleReveal }: TownVideoTileProps) {
  const { t } = useTranslation('common');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !revealed) return;
    video.track.attach(el);
    return () => {
      video.track.detach(el);
    };
  }, [video.track, revealed]);

  useEffect(() => {
    if (video.local) return;
    let alive = true;
    void resolveDisplayNameForDid(video.did).then((n) => {
      if (alive) setName(n);
    });
    return () => {
      alive = false;
    };
  }, [video.did, video.local]);

  const label = video.local ? t('town.voice.you') : (name ?? t('town.voice.camera'));
  return (
    <figure className={styles.videoTile}>
      {revealed && video.paused && (
        <div className={styles.videoPaused} role="status">
          {t('town.voice.videoPaused')}
        </div>
      )}
      {revealed ? (
        <video
          ref={videoRef}
          className={`${styles.video} ${video.local ? styles.mirror : ''}`}
          autoPlay
          playsInline
          muted
          aria-label={label}
        />
      ) : (
        <div className={styles.videoHidden}>
          <span>{t('town.voice.videoHidden')}</span>
          <button
            type="button"
            className={styles.voiceButton}
            onClick={() => {
              onToggleReveal(video.key);
            }}
          >
            {t('town.voice.showVideo')}
          </button>
        </div>
      )}
      <figcaption className={styles.videoName}>
        {label}
        {revealed && !video.local && (
          <button
            type="button"
            className={styles.hideVideo}
            onClick={() => {
              onToggleReveal(video.key);
            }}
          >
            {t('town.voice.hideVideo')}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
