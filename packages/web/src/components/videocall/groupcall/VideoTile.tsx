import { memo } from 'react';
import {
  VideoTrack,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';

export interface VideoTileProps {
  /** May be a placeholder (camera off) — `publication` is then undefined. */
  trackRef: TrackReferenceOrPlaceholder;
  /** "sid:source" key — identity for selection and the PiP ref map. */
  trackKeyStr: string;
  isLocal: boolean;
  isSpeaking: boolean;
  /** True when the call is in focus mode and this tile sits in the side strip. */
  inStrip: boolean;
  label: string;
  /** Stable: selects this tile (toggles focus/pin). */
  onSelect: (trackKeyStr: string) => void;
  /** Stable: registers/unregisters the <video> element for the PiP compositor. */
  registerVideoRef: (trackKeyStr: string, el: HTMLVideoElement | null) => void;
}

/**
 * Skip re-rendering a tile unless something it actually displays changed.
 * `useTracks` hands back fresh TrackReference objects every render, so a plain
 * shallow compare would never bail — we compare the meaningful fields instead.
 */
function tilesEqual(a: VideoTileProps, b: VideoTileProps): boolean {
  return (
    a.trackKeyStr === b.trackKeyStr &&
    a.trackRef.publication?.trackSid === b.trackRef.publication?.trackSid &&
    // Track-object identity, not truthiness — a swap under a stable trackSid
    // (republish, restart) must re-render so <VideoTrack> re-attaches.
    a.trackRef.publication?.track === b.trackRef.publication?.track &&
    a.isLocal === b.isLocal &&
    a.isSpeaking === b.isSpeaking &&
    a.inStrip === b.inStrip &&
    a.label === b.label &&
    a.onSelect === b.onSelect &&
    a.registerVideoRef === b.registerVideoRef
  );
}

export const VideoTile = memo(function VideoTile({
  trackRef,
  trackKeyStr,
  isLocal,
  isSpeaking,
  inStrip,
  label,
  onSelect,
  registerVideoRef,
}: VideoTileProps) {
  const hasVideo = !!trackRef.publication?.track;

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#1a1a2e',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flex: inStrip ? 1 : undefined,
        minHeight: inStrip ? 0 : undefined,
        border: isSpeaking ? '2px solid var(--color-success)' : '2px solid transparent',
      }}
      onClick={() => {
        onSelect(trackKeyStr);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(trackKeyStr);
        }
      }}
      title="Click to focus"
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef as TrackReference}
          ref={(el: HTMLVideoElement | null) => {
            registerVideoRef(trackKeyStr, el);
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
            fontSize: inStrip ? '0.9rem' : '1.5rem',
            fontWeight: 700,
          }}
        >
          {label}
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
        {label}
      </span>
    </div>
  );
}, tilesEqual);
