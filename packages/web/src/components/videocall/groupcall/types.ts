import { Track, VideoPresets } from 'livekit-client';
import type { RoomOptions } from 'livekit-client';

// ── Constants ──

export const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '😮', '💯'];
export const DISPLAY_NAME_KEY = 'protoimsg:groupCallName';
export const AUTO_FOCUS_KEY = 'protoimsg:groupCallAutoFocus';

/**
 * Max video tiles mounted at once. Tiles beyond this are paginated; since
 * unmounted tracks have no <VideoTrack> element, adaptiveStream pauses them
 * server-side, so a 100+ person call only ever streams ~this many videos.
 */
export const MAX_VISIBLE_TILES = 25;

/**
 * Room options tuned for large calls:
 * - adaptiveStream: pauses/downscales tracks based on rendered element size
 * - dynacast: stops publishing simulcast layers nobody is subscribed to
 * - simulcast layers: lets the SFU send a cheap layer to small grid tiles
 */
export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  },
};

// ── Shared types ──

export interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  text: string;
  ts: number;
}

export interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number; // % from left
  ts: number;
}

// ── Data channel codec ──

export type DataMsg =
  | { type: 'chat'; id: string; sender: string; senderName: string; text: string }
  | { type: 'emoji'; emoji: string; sender: string }
  | { type: 'name'; sender: string; name: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeData(msg: DataMsg): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

export function decodeData(data: Uint8Array): DataMsg | null {
  try {
    return JSON.parse(decoder.decode(data)) as DataMsg;
  } catch {
    return null;
  }
}

/** Unique key for a track: "sid:source" — distinguishes camera vs screen share. */
export function trackKey(t: { participant: { sid: string }; source: Track.Source }): string {
  return `${t.participant.sid}:${t.source}`;
}
