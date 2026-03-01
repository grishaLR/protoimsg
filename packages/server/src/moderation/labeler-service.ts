import { APP_LABELERS, USER_AGENT } from '@protoimsg/shared';
import { createLogger } from '../logger.js';

const log = createLogger('labeler');

const PUBLIC_API = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles';
const LABELER_HEADER = APP_LABELERS.map((l) => `${l.did};redact`).join(', ');

interface CacheEntry {
  labels: string[];
  fetchedAt: number;
}

interface ProfileLabel {
  val: string;
  neg?: boolean;
  src: string;
}

interface ProfileResponse {
  profiles: Array<{
    did: string;
    labels?: ProfileLabel[];
  }>;
}

/**
 * Fetches account labels via the Bluesky public API with the
 * `atproto-accept-labelers` header. This is the same mechanism the
 * client uses and doesn't require labeler-specific auth.
 *
 * Results are cached in-memory with a 5-minute TTL.
 * Fails open on network errors — logs a warning and allows the user through.
 */
export class LabelerService {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 min
  private readonly labelerDids: Set<string>;

  constructor() {
    this.labelerDids = new Set(APP_LABELERS.map((l) => l.did));
    log.info({ labelers: [...this.labelerDids] }, 'LabelerService initialized');
  }

  /** Get all active labels for a DID from configured labelers. */
  async getLabels(did: string): Promise<string[]> {
    const cached = this.cache.get(did);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < this.TTL_MS) {
      return cached.labels;
    }

    try {
      const params = new URLSearchParams();
      params.append('actors', did);

      const res = await fetch(`${PUBLIC_API}?${params.toString()}`, {
        headers: { 'atproto-accept-labelers': LABELER_HEADER, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        log.warn({ did, status: res.status }, 'Profile fetch for labels failed');
        if (cached) return cached.labels;
        return [];
      }

      const data = (await res.json()) as ProfileResponse;
      const profile = data.profiles.find((p) => p.did === did);

      if (!profile?.labels) {
        this.cache.set(did, { labels: [], fetchedAt: now });
        return [];
      }

      // Only keep labels from our configured labelers
      const active = new Set<string>();
      for (const label of profile.labels) {
        if (!this.labelerDids.has(label.src)) continue;
        if (label.neg) {
          active.delete(label.val);
        } else {
          active.add(label.val);
        }
      }

      const result = [...active];
      this.cache.set(did, { labels: result, fetchedAt: now });
      return result;
    } catch (err) {
      // Fail open — use stale cache if available, otherwise allow user through
      log.warn(
        { did, err: err instanceof Error ? err.message : String(err) },
        'Label fetch error — failing open',
      );
      if (cached) return cached.labels;
      return [];
    }
  }

  /** Check if a DID has any !hide label from configured labelers. */
  async shouldRestrict(did: string): Promise<boolean> {
    const labels = await this.getLabels(did);
    return labels.includes('!hide');
  }
}
