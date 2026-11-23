/** Types and reusable pieces for the game listings in this folder. */

/** One entry of a define record's `uses` list. */
export interface RecordUse {
  role: string;
  nsid: string;
  rkey?: string;
  path?: string;
  purpose?: string;
  acquire?: string;
}

/** What a game's own script supplies. Everything else is filled in here. */
export interface GameDefine {
  /** Record key. Stable forever — the status records link to it. */
  rkey: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  uses: RecordUse[];
}

// Not a `requires` gate: the open arcade is playable with a ready-made
// character. Your own rpg.actor sprite is what you play as when signed in.
export const USES_SPRITE: RecordUse = {
  role: 'character',
  nsid: 'actor.rpg.sprite',
  rkey: 'self',
  purpose: 'Play as your own rpg.actor character',
  acquire: 'https://rpg.actor/generator',
};

/** The player's personal best / worst / tries, under `path` in their stats record. */
export function usesStats(path: string): RecordUse {
  return {
    role: 'stats',
    nsid: 'actor.rpg.stats',
    rkey: 'self',
    path,
    purpose: 'Your personal best, worst and number of tries',
  };
}

export const USES_STATUS: RecordUse = {
  role: 'activity',
  nsid: 'games.atmosphere.status',
  rkey: 'any',
  purpose: 'Optional "now playing" status while a session is live',
};
