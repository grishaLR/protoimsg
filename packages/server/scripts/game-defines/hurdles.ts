#!/usr/bin/env node
/**
 * Publish (or update) Hurdles's `games.atmosphere.define` record in the game
 * master's repo. Production, run by hand: once before the game's live status
 * ships, and again whenever the listing below changes. See ./publish.ts.
 *
 * Usage (from packages/server):
 *   PDS_URL=https://pds.protoimsg.app \
 *   BLUESKY_HANDLE=<game-master-handle> \
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx \
 *   npx tsx scripts/game-defines/hurdles.ts
 *
 *   ... check the output, then re-run with --write to publish.
 */

import { publishGameDefine, usesStats, USES_SPRITE, USES_STATUS } from './publish.js';

publishGameDefine({
  rkey: 'hurdles',
  name: 'Hurdles',
  tagline: 'Run, jump the flowers, and double-jump the UFOs.',
  description:
    'An endless side-scrolling runner played as your rpg.actor character. Hop the flowers, jump the low UFOs, run under the high ones, and double-jump the combos. Scores are replayed and verified server-side.',
  tags: ['arcade', 'runner', 'endless', 'leaderboard'],
  uses: [USES_SPRITE, usesStats('hurdles'), USES_STATUS],
});
