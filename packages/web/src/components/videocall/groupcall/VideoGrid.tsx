import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  useTracks,
  useRoomContext,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTO_FOCUS_KEY, MAX_VISIBLE_TILES, trackKey } from './types';
import { VideoTile } from './VideoTile';
import styles from '../VideoCallOverlay.module.css';

interface VideoGridProps {
  /** Shared with the PiP compositor — maps "sid:source" → <video> element. */
  tileVideoRefs: { current: Map<string, HTMLVideoElement> };
  /** VideoGrid writes the on-screen track list here for the PiP compositor. */
  pipTracksRef: { current: TrackReferenceOrPlaceholder[] };
  /** Display-name lookup populated by the data channel. */
  participantNames: Record<string, string>;
}

/**
 * The video area: track subscription, focus/pin, active speaker, and the
 * paginated tile grid. Memoized — its props are stable refs plus the name
 * table, so chat/emoji churn in the parent never re-renders the tiles; only
 * its own LiveKit hooks, its state, and name updates drive it.
 */
export const VideoGrid = memo(function VideoGrid({
  tileVideoRefs,
  pipTracksRef,
  participantNames,
}: VideoGridProps) {
  const { t } = useTranslation('common');
  const room = useRoomContext();

  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [autoFocus] = useState(() => localStorage.getItem(AUTO_FOCUS_KEY) !== 'false');
  const [activeSpeakerSid, setActiveSpeakerSid] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const videoTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  // ── Active speaker detection ──
  useEffect(() => {
    const handler = (speakers: Participant[]) => {
      const remote = speakers.find((s) => !s.isLocal);
      if (remote) setActiveSpeakerSid(remote.sid);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handler);
    };
  }, [room]);

  // ── Focus target: manual pin > screen share > active speaker ──
  const screenShareTrack = videoTracks.find(
    (tr) => tr.source === Track.Source.ScreenShare && !tr.participant.isLocal,
  );

  const effectivePinned = useMemo(() => {
    if (pinnedKey) return pinnedKey;
    if (screenShareTrack) return trackKey(screenShareTrack);
    if (autoFocus && activeSpeakerSid) return `${activeSpeakerSid}:${Track.Source.Camera}`;
    return null;
  }, [pinnedKey, screenShareTrack, activeSpeakerSid, autoFocus]);

  const hasFocus = !!effectivePinned && videoTracks.length > 1;
  const focusedTrack = hasFocus
    ? videoTracks.find((tr) => trackKey(tr) === effectivePinned)
    : undefined;
  const otherTracks = hasFocus
    ? videoTracks.filter((tr) => trackKey(tr) !== effectivePinned)
    : videoTracks;

  // ── Pagination — local participant first so "you" stay visible on flips ──
  const orderedTracks = useMemo(() => {
    const local = otherTracks.filter((tr) => tr.participant.isLocal);
    const remote = otherTracks.filter((tr) => !tr.participant.isLocal);
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

  // Feed the PiP compositor: focused tile + this page. Written in an effect so
  // concurrent/discarded renders can't leave the ref holding stale tracks.
  useEffect(() => {
    pipTracksRef.current = focusedTrack ? [focusedTrack, ...visibleTracks] : visibleTracks;
  }, [focusedTrack, visibleTracks, pipTracksRef]);

  const tileCount = visibleTracks.length || 1;
  const cols = hasFocus ? 1 : tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 9 ? 3 : 4;
  const rows = hasFocus ? tileCount : Math.ceil(tileCount / cols);

  // ── Stable callbacks so memoized tiles can bail on parent re-render ──
  const getLabel = useCallback(
    (p: { identity: string; isLocal: boolean }) =>
      participantNames[p.identity] ?? (p.isLocal ? 'You' : p.identity.slice(0, 8)),
    [participantNames],
  );

  const selectTile = useCallback((key: string) => {
    setPinnedKey((prev) => (prev === key ? null : key));
  }, []);

  const registerVideoRef = useCallback(
    (key: string, el: HTMLVideoElement | null) => {
      if (el) tileVideoRefs.current.set(key, el);
      else tileVideoRefs.current.delete(key);
    },
    [tileVideoRefs],
  );

  const tiles = visibleTracks.map((tr) => (
    <VideoTile
      key={trackKey(tr)}
      trackRef={tr}
      trackKeyStr={trackKey(tr)}
      isLocal={tr.participant.isLocal}
      isSpeaking={tr.participant.sid === activeSpeakerSid}
      inStrip={hasFocus}
      label={getLabel(tr.participant)}
      onSelect={selectTile}
      registerVideoRef={registerVideoRef}
    />
  ));

  return (
    <div className={styles.videosContainer} style={{ display: 'flex', flexDirection: 'column' }}>
      {hasFocus ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', gap: 2 }}>
          {/* Focused tile (large) */}
          <div
            role="button"
            tabIndex={0}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPinnedKey(null);
              }
            }}
            title="Click to unpin"
          >
            {focusedTrack?.publication?.track ? (
              <VideoTrack
                trackRef={focusedTrack}
                ref={(el: HTMLVideoElement | null) => {
                  registerVideoRef(trackKey(focusedTrack), el);
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  transform: focusedTrack.participant.isLocal ? 'scaleX(-1)' : undefined,
                }}
              />
            ) : (
              focusedTrack && (
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
                    {getLabel(focusedTrack.participant)}
                  </span>
                </div>
              )
            )}
            {focusedTrack && (
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
                {getLabel(focusedTrack.participant)}
              </span>
            )}
            {focusedTrack?.participant.sid === activeSpeakerSid && (
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
          {/* Side strip */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minHeight: 0,
            }}
          >
            {tiles}
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: 2,
          }}
        >
          {tiles}
        </div>
      )}

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
            flexShrink: 0,
          }}
        >
          <button
            className={styles.controlBtn}
            onClick={() => {
              setPage((p) => Math.max(0, p - 1));
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
            disabled={safePage === pageCount - 1}
            aria-label={t('videoCall.nextPage', { defaultValue: 'Next page' })}
            style={{ width: 28, height: 28, opacity: safePage === pageCount - 1 ? 0.4 : 1 }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
});
