#!/usr/bin/env node
/**
 * Publish (or update) Hopper's `games.atmosphere.define` record in the game
 * master's repo. Production, run by hand: once before the game's live status
 * ships, and again whenever the listing below changes. See ./publish.ts.
 *
 * Usage (from packages/server):
 *   PDS_URL=https://pds.protoimsg.app \
 *   BLUESKY_HANDLE=<game-master-handle> \
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx \
 *   npx tsx scripts/game-defines/hopper.ts
 *
 *   ... check the output, then re-run with --write to publish.
 */

import { publishGameDefine, usesStats, USES_SPRITE, USES_STATUS } from './publish.js';

publishGameDefine({
  rkey: 'hopper',
  name: 'Hopper',
  tagline: 'Bounce up through space. Dodge the UFOs and the black holes.',
  description:
    'An endless vertical hopper played as your rpg.actor character. Springs, crumbling and moving platforms, UFOs you can stomp, black holes you cannot. Scores are replayed and verified server-side; reach the top 5 to earn a Jet Pack.',
  tags: ['arcade', 'platformer', 'endless', 'leaderboard'],
  uses: [USES_SPRITE, usesStats('hopper'), USES_STATUS],
});
