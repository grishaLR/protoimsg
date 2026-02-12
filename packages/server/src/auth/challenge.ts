import { randomBytes } from 'crypto';

const CHALLENGE_TTL_MS = 60_000; // 60 seconds

interface PendingChallenge {
  nonce: string;
  expiresAt: number;
}

export class ChallengeStore {
  private challenges = new Map<string, PendingChallenge>();

  create(did: string): string {
    const nonce = randomBytes(32).toString('hex');
    this.challenges.set(did, {
      nonce,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return nonce;
  }

  consume(did: string, nonce: string): boolean {
    const challenge = this.challenges.get(did);
    if (!challenge) return false;
    this.challenges.delete(did);
    if (Date.now() >= challenge.expiresAt) return false;
    return challenge.nonce === nonce;
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [did, challenge] of this.challenges) {
      if (now >= challenge.expiresAt) {
        this.challenges.delete(did);
        pruned++;
      }
    }
    return pruned;
  }
}
