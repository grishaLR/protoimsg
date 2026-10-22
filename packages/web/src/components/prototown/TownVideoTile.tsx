import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProximityVideo } from '../../town/ProximityVoice';
import { resolveDisplayNameForDid } from '../../lib/resolve-pds';
import styles from './ProtoTownPanel.module.css';

/** One camera feed in a proximity conversation. Your own is mirrored. */
export function TownVideoTile({ video }: { video: ProximityVideo }) {
  const { t } = useTranslation('common');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    video.track.attach(el);
    return () => {
      video.track.detach(el);
    };
  }, [video.track]);

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

  const label = video.local ? t('town.voice.you') : (name ?? '');
  return (
    <figure className={styles.videoTile}>
      <video
        ref={videoRef}
        className={`${styles.video} ${video.local ? styles.mirror : ''}`}
        autoPlay
        playsInline
        muted
        aria-label={label}
      />
      {label && <figcaption className={styles.videoName}>{label}</figcaption>}
    </figure>
  );
}
