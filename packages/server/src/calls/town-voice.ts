import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { generateAnonymousToken } from './token.js';
import { createLogger } from '../logger.js';

const log = createLogger('town-voice');

/**
 * Proximity tokens are short-lived, but LiveKit tokens can't be revoked (and
 * are refreshed in-session), so a kicked participant may still hold a valid
 * one. TownRoom therefore reconciles each room against its expected roster,
 * and clients only grant track subscriptions to roster members.
 */
const TOKEN_TTL_SECONDS = 30;

/**
 * Mic + camera only — never screen share or data, enforced in the token so a
 * modified client can't push them. Camera is opt-in per conversation on the
 * client (off by default, off again when the cluster ends), and only roster
 * members may subscribe to it, same as audio.
 */
const PUBLISH = { sources: [TrackSource.MICROPHONE, TrackSource.CAMERA], data: false };

/** Seconds LiveKit keeps an emptied proximity room before closing it. */
const EMPTY_TIMEOUT_SECONDS = 30;

/** LiveKit operations backing proto town's proximity voice rooms. */
export interface TownVoice {
  readonly url: string;
  /** Create the room up front so its participant cap is enforced. */
  ensureRoom(room: string, maxParticipants: number): Promise<void>;
  /** Anonymous token for `participantId` — carries no DID. */
  issueToken(room: string, participantId: string): Promise<string>;
  /** Best-effort eviction of a participant who left the cluster. */
  removeParticipant(room: string, participantId: string): void;
  /** Identities currently connected to a room (for reconciliation). */
  listParticipants(room: string): Promise<string[]>;
}

export function createTownVoice(url: string, apiKey: string, apiSecret: string): TownVoice {
  const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);

  return {
    url,
    async ensureRoom(room, maxParticipants) {
      await roomService.createRoom({
        name: room,
        emptyTimeout: EMPTY_TIMEOUT_SECONDS,
        maxParticipants,
      });
    },
    issueToken(room, participantId) {
      return generateAnonymousToken(
        apiKey,
        apiSecret,
        room,
        participantId,
        TOKEN_TTL_SECONDS,
        PUBLISH,
      );
    },
    removeParticipant(room, participantId) {
      // Throws "not found" if they never connected or already left — expected.
      roomService.removeParticipant(room, participantId).catch((err: unknown) => {
        log.debug({ err, room }, 'Proximity participant eviction skipped');
      });
    },
    async listParticipants(room) {
      const participants = await roomService.listParticipants(room);
      return participants.map((p) => p.identity);
    },
  };
}
