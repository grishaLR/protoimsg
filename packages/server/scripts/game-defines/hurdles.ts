/** The Hurdles listing — its `games.atmosphere.define` record. Published by ./publish.ts. */

import { usesStats, USES_SPRITE, USES_STATUS, type GameDefine } from './shared.js';

export const hurdles: GameDefine = {
  rkey: 'hurdles',
  name: 'Hurdles',
  tagline: 'Run, jump the flowers, and double-jump the UFOs.',
  description:
    'An endless side-scrolling runner played as your rpg.actor character. Hop the flowers, jump the low UFOs, run under the high ones, and double-jump the combos. Scores are replayed and verified server-side.',
  tags: ['arcade', 'runner', 'endless', 'leaderboard'],
  uses: [USES_SPRITE, usesStats('hurdles'), USES_STATUS],
};
