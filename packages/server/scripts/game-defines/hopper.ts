/** The Hopper listing — its `games.atmosphere.define` record. Published by ./publish.ts. */

import { usesStats, USES_SPRITE, USES_STATUS, type GameDefine } from './shared.js';

export const hopper: GameDefine = {
  rkey: 'hopper',
  name: 'Hopper',
  tagline: 'Bounce up through space. Dodge the UFOs and the black holes.',
  description:
    'An endless vertical hopper played as your rpg.actor character. Springs, crumbling and moving platforms, UFOs you can stomp, black holes you cannot. Scores are replayed and verified server-side; reach the top 5 to earn a Jet Pack.',
  tags: ['arcade', 'platformer', 'endless', 'leaderboard'],
  uses: [USES_SPRITE, usesStats('hopper'), USES_STATUS],
};
