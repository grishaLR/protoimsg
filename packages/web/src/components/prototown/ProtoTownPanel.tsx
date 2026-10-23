import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TOWN_PROXIMITY } from '@protoimsg/shared';
import type { PresenceVisibility, ServerMessage } from '@protoimsg/shared';
import { useAuth } from '../../hooks/useAuth';
import { getCachedVisibility } from '../../hooks/usePresence';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { WorldEngine } from '../../town/WorldEngine';
import { ProximityVoice, type ProximityVideo } from '../../town/ProximityVoice';
import { TownVideoWindow } from './TownVideoWindow';
import { TownBetaNotice } from './TownBetaNotice';
import type { TownArea } from '../../town/WorldEngine';
import type { TownZone } from '../../town/map';
import { zoneAtPixel } from '../../town/map';
import styles from './ProtoTownPanel.module.css';

// Visibility-IS-location: the zone you stand in decides who can see you.
const ZONE_VISIBILITY: Record<TownZone, PresenceVisibility> = {
  home: 'no-one',
  // Open for now — becomes community-only when neighborhoods are gated.
  neighborhood: 'everyone',
  public: 'everyone',
};

const MIC_STORAGE_KEY = 'protoimsg:townMic';
const VOLUME_TICK_MS = 250;
// Full volume inside the join radius, easing down for mesh members who are
// only linked through someone else.
const MIN_VOLUME = 0.3;
const FADE_DIST = TOWN_PROXIMITY.joinRadius * 3;

function readMicPref(): boolean {
  try {
    return localStorage.getItem(MIC_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeMicPref(on: boolean): void {
  try {
    localStorage.setItem(MIC_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // localStorage unavailable
  }
}

function volumeAt(dist: number | null): number {
  if (dist === null) return MIN_VOLUME;
  const { joinRadius } = TOWN_PROXIMITY;
  if (dist <= joinRadius) return 1;
  const t = Math.min(1, (dist - joinRadius) / (FADE_DIST - joinRadius));
  return 1 - t * (1 - MIN_VOLUME);
}

export function ProtoTownPanel() {
  const { t } = useTranslation('common');
  const { did } = useAuth();
  const { send, subscribe, connected } = useWebSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioHostRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<ProximityVoice | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [micOn, setMicOn] = useState(readMicPref);
  const [micError, setMicError] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  // People close by that you are NOT in a voice room with, and where you stand —
  // together they explain why voice is off ("community only here").
  const [nearbyUnlinked, setNearbyUnlinked] = useState(0);
  const [zone, setZone] = useState<TownZone | null>(null);
  // Area label tooltip (hover/tap), and a short note when you walk into an area.
  const [areaTip, setAreaTip] = useState<{ area: TownArea; x: number; y: number } | null>(null);
  const [zoneNote, setZoneNote] = useState<TownZone | null>(null);
  const [bannerShown, setBannerShown] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [videos, setVideos] = useState<ProximityVideo[]>([]);
  const [cameraPending, setCameraPending] = useState(false);
  // Why the camera last changed — drives announcements + the "someone joined" notice.
  const [cameraEvent, setCameraEvent] = useState<'on' | 'off' | 'joined' | null>(null);
  // Other people's video starts hidden; you reveal each feed yourself.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  // Screen-reader announcement on voice transitions only, not every roster tick.
  const [announcement, setAnnouncement] = useState('');
  const prevNearbyRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;
  const sendRef = useRef(send);
  sendRef.current = send;
  // Bumped when an engine finishes initialising — gates the WS-join effect so
  // it runs once the engine is ready, and re-runs when the engine is recreated.
  const [engineEpoch, setEngineEpoch] = useState(0);

  // Engine lifecycle — tied to the authenticated DID. town_leave is sent here
  // (real unmount / DID change), never on a transient reconnect.
  useEffect(() => {
    const container = containerRef.current;
    const audioHost = audioHostRef.current;
    if (!container || !audioHost || !did) return;
    const engine = new WorldEngine();
    engineRef.current = engine;

    const voice = new ProximityVoice(audioHost, did, readMicPref());
    voiceRef.current = voice;
    voice.onMembersChange = (dids) => {
      engine.setVoiceCluster(dids);
      setNearbyCount(Math.max(0, dids.length - 1));
    };
    voice.onSpeakingChange = (dids) => {
      engine.setSpeaking(dids);
    };
    voice.onAudioBlockedChange = setAudioBlocked;
    voice.onLiveChange = setMicLive;
    voice.onVideoChange = setVideos;
    voice.onCameraChange = (on, reason) => {
      setCameraOn(on);
      // 'ended' is already covered by the "voice ended" announcement.
      if (reason !== 'ended') setCameraEvent(on ? 'on' : (reason ?? 'off'));
    };
    voice.onCameraPendingChange = setCameraPending;
    voice.onCameraError = () => {
      setCameraError(true);
    };
    voice.onMicError = () => {
      setMicOn(false);
      setMicError(true);
      writeMicPref(false);
    };
    voice.onRequestRefresh = () => {
      sendRef.current({ type: 'town_voice_refresh' });
    };
    const volumeTimer = setInterval(() => {
      voice.setVolumes((peerDid) => volumeAt(engine.distanceTo(peerDid)));
    }, VOLUME_TICK_MS);
    // Walking (a keypress) or clicking is a user gesture — use it to lift any
    // autoplay block so the "click to hear" button is rarely needed.
    const unlockAudio = (): void => {
      void voice.startAudio();
    };
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('pointerdown', unlockAudio);

    engine.onMove = (x, y, dir) => {
      sendRef.current({ type: 'town_move', x, y, dir });
    };
    engine.onNearbyUnlinkedChange = setNearbyUnlinked;
    engine.onAreaHover = (area, x, y) => {
      setAreaTip(area ? { area, x, y } : null);
    };
    engine.onZoneChange = (next) => {
      setZone(next);
      setZoneNote(next);
      sendRef.current({
        type: 'status_change',
        status: 'online',
        visibleTo: ZONE_VISIBILITY[next],
      });
    };
    void engine.init(container, did).then(() => {
      if (engineRef.current === engine) setEngineEpoch((e) => e + 1);
    });
    engine.setAreaLabels({
      home: tRef.current('town.areas.home.label'),
      neighborhood: tRef.current('town.areas.neighborhood.label'),
    });
    return () => {
      clearInterval(volumeTimer);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
      voiceRef.current = null;
      voice.destroy();
      setVoiceSupported(false);
      setNearbyCount(0);
      setNearbyUnlinked(0);
      setZone(null);
      setAudioBlocked(false);
      setMicLive(false);
      setCameraOn(false);
      setCameraError(false);
      setCameraPending(false);
      setCameraEvent(null);
      setVideos([]);
      setRevealed(new Set());
      setMicError(false);
      sendRef.current({ type: 'town_leave' });
      // Leaving town: restore the visibility the user set outside of it.
      sendRef.current({
        type: 'status_change',
        status: 'online',
        visibleTo: getCachedVisibility(),
      });
      engineRef.current = null;
      engine.destroy();
    };
  }, [did]);

  // Join the town and subscribe to peer events — only once the socket is
  // connected and the engine is ready.
  useEffect(() => {
    if (!connected || engineEpoch === 0) return;
    const engine = engineRef.current;
    if (!engine) return;
    const p = engine.getPosition();
    setZone(zoneAtPixel(p.x, p.y));
    send({ type: 'town_join', x: p.x, y: p.y, dir: p.dir });
    // Initial visibility for the zone the player spawns in.
    send({
      type: 'status_change',
      status: 'online',
      visibleTo: ZONE_VISIBILITY[zoneAtPixel(p.x, p.y)],
    });
    const unsub = subscribe((msg: ServerMessage) => {
      const e = engineRef.current;
      if (!e) return;
      switch (msg.type) {
        case 'town_state':
          e.setPeers(msg.data.peers);
          setVoiceSupported(msg.data.voice);
          // Warm up DNS/TLS to LiveKit before anyone walks up to you.
          if (msg.data.voiceUrl) voiceRef.current?.prepare(msg.data.voiceUrl);
          break;
        case 'town_view':
          // Batched: who appeared/moved in your view, and who left it.
          for (const p of msg.data.upsert) e.peerMove(p);
          for (const peerDid of msg.data.remove) e.peerLeave(peerDid);
          break;
        case 'town_proximity':
          void voiceRef.current?.assign(msg.data.room);
          break;
        case 'town_peer_join':
          e.peerJoin(msg.data);
          break;
        case 'town_peer_move':
          e.peerMove(msg.data);
          break;
        case 'town_peer_leave':
          e.peerLeave(msg.data.did);
          break;
        case 'town_chat':
          e.showChat(msg.data.did, msg.data.text);
          break;
        default:
          break;
      }
    });
    return () => {
      unsub();
      // Socket gone: the server has already evicted us from voice; a fresh
      // assignment follows the next town_join.
      void voiceRef.current?.assign(null);
    };
  }, [connected, engineEpoch, subscribe, send]);

  useEffect(() => {
    const prev = prevNearbyRef.current;
    prevNearbyRef.current = nearbyCount;
    if (prev === 0 && nearbyCount > 0) setAnnouncement(t('town.voice.announceJoined'));
    else if (prev > 0 && nearbyCount === 0) {
      setAnnouncement(t('town.voice.announceEnded'));
      // New conversation, fresh consent: hide everyone's video again.
      setRevealed(new Set());
    }
  }, [nearbyCount, t]);

  useEffect(() => {
    if (!cameraEvent) return;
    const key =
      cameraEvent === 'on'
        ? 'town.voice.camOnAnnounce'
        : cameraEvent === 'joined'
          ? 'town.voice.camAutoOff'
          : 'town.voice.camOffAnnounce';
    setAnnouncement(t(key));
    if (cameraEvent !== 'joined') return;
    // Keep the visible "someone joined" notice up briefly.
    const timer = setTimeout(() => {
      setCameraEvent(null);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [cameraEvent, t]);

  const toggleCamera = useCallback(() => {
    setCameraError(false);
    setCameraEvent(null);
    void voiceRef.current?.toggleCamera();
  }, []);

  // With your own camera on you've opted into a video conversation, so others'
  // feeds show automatically. Otherwise they start hidden until you reveal
  // them — and a newcomer turns your camera off, so they always start hidden.
  const isRevealed = useCallback(
    (v: ProximityVideo) => v.local || cameraOn || revealed.has(v.key),
    [cameraOn, revealed],
  );

  const toggleReveal = useCallback((key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    setMicError(false);
    writeMicPref(next);
    void voiceRef.current?.startAudio();
    void voiceRef.current?.setMicEnabled(next);
  }, [micOn]);

  const enableAudio = useCallback(() => {
    void voiceRef.current?.startAudio();
  }, []);

  // Relabel areas when the language changes.
  useEffect(() => {
    if (engineEpoch === 0) return;
    engineRef.current?.setAreaLabels({
      home: t('town.areas.home.label'),
      neighborhood: t('town.areas.neighborhood.label'),
    });
  }, [t, engineEpoch]);

  // The "you're entering…" note fades after a few seconds.
  useEffect(() => {
    if (!zoneNote) return;
    const timer = setTimeout(() => {
      setZoneNote(null);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [zoneNote]);

  const sendChat = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (text) send({ type: 'town_chat', text: text.slice(0, 280) });
    input.value = '';
    input.blur();
  }, [send]);

  return (
    <div className={styles.panel}>
      <div className={styles.world} ref={containerRef} />
      <div ref={audioHostRef} hidden />
      <div className={styles.srOnly} aria-live="polite">
        {announcement}
      </div>
      <TownBetaNotice onBannerChange={setBannerShown} />
      {areaTip && (
        <div className={styles.areaTip} role="tooltip" style={{ left: areaTip.x, top: areaTip.y }}>
          <strong>{t(`town.areas.${areaTip.area}.label`)}</strong>
          <span>{t(`town.areas.${areaTip.area}.tooltip`)}</span>
        </div>
      )}
      {zoneNote && (
        <div className={styles.zoneNote} role="status">
          {t(`town.areas.${zoneNote}.enter`)}
        </div>
      )}
      <div className={`${styles.topBar} ${bannerShown ? styles.belowBanner : ''}`}>
        <div className={styles.hud}>{t('town.hud.controls')}</div>
        {voiceSupported && (
          <div className={styles.voiceBar}>
            {nearbyCount > 0 && (
              <span className={`${styles.nearby} ${micLive ? styles.live : ''}`}>
                {micLive
                  ? t('town.voice.live', { count: nearbyCount })
                  : t('town.voice.nearby', { count: nearbyCount })}
              </span>
            )}
            {audioBlocked && nearbyCount > 0 && (
              <button type="button" className={styles.voiceButton} onClick={enableAudio}>
                {t('town.voice.enableAudio')}
              </button>
            )}
            <button
              type="button"
              className={`${styles.voiceButton} ${micOn ? styles.micOn : ''}`}
              onClick={toggleMic}
            >
              {micOn ? t('town.voice.micOn') : t('town.voice.micOff')}
            </button>
            {/* Never hide the off switch while the camera is live or starting. */}
            {(nearbyCount > 0 || cameraOn || cameraPending) && (
              <button
                type="button"
                className={`${styles.voiceButton} ${cameraOn ? styles.micOn : ''}`}
                aria-busy={cameraPending}
                onClick={toggleCamera}
              >
                {cameraPending
                  ? t('town.voice.camStarting')
                  : cameraOn
                    ? t('town.voice.camOn')
                    : t('town.voice.camOff')}
              </button>
            )}
            {cameraOn && (
              <span className={`${styles.nearby} ${styles.camLive}`}>
                {t('town.voice.camLive')}
              </span>
            )}
            {cameraEvent === 'joined' && (
              <span className={styles.nearby}>{t('town.voice.camAutoOff')}</span>
            )}
            {nearbyUnlinked > 0 && zone === 'home' && (
              <span className={styles.nearby}>{t('town.voice.homeOff')}</span>
            )}
            {micError && (
              <span className={styles.micError} role="alert">
                {t('town.voice.micDenied')}
              </span>
            )}
            {cameraError && (
              <span className={styles.micError} role="alert">
                {t('town.voice.camDenied')}
              </span>
            )}
          </div>
        )}
      </div>
      {videos.length > 0 && (
        <TownVideoWindow videos={videos} isRevealed={isRevealed} onToggleReveal={toggleReveal} />
      )}
      <form
        className={styles.chatBar}
        onSubmit={(e) => {
          e.preventDefault();
          sendChat();
        }}
      >
        <input
          ref={inputRef}
          className={styles.chatInput}
          aria-label={t('town.chat.placeholder')}
          placeholder={t('town.chat.placeholder')}
          maxLength={280}
          onFocus={() => engineRef.current?.setInputEnabled(false)}
          onBlur={() => engineRef.current?.setInputEnabled(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <button type="submit" className={styles.chatSend}>
          {t('town.chat.send')}
        </button>
      </form>
    </div>
  );
}
