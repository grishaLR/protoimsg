/**
 * Detect embed player type from a URL.
 * Simplified from Bluesky social-app's embed-player.ts (MIT license).
 * Only covers types we render inline — GIFs and basic detection.
 */

export type EmbedPlayerType =
  | 'giphy_gif'
  | 'tenor_gif'
  | 'youtube_video'
  | 'spotify_song'
  | 'unknown';

export interface EmbedPlayerInfo {
  type: EmbedPlayerType;
  playerUri: string;
  isGif: boolean;
}

export function parseEmbedPlayer(uri: string): EmbedPlayerInfo | null {
  try {
    const url = new URL(uri);
    const host = url.hostname.toLowerCase();

    // GIPHY
    if (host === 'media.giphy.com' || host.endsWith('.giphy.com')) {
      return { type: 'giphy_gif', playerUri: uri, isGif: true };
    }
    if (host === 'giphy.com' || host === 'www.giphy.com') {
      return { type: 'giphy_gif', playerUri: uri, isGif: true };
    }

    // Tenor
    if (host === 'media.tenor.com' || host === 'tenor.com' || host === 'www.tenor.com') {
      return { type: 'tenor_gif', playerUri: uri, isGif: true };
    }

    // YouTube (detection only — no inline player)
    if (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be'
    ) {
      return { type: 'youtube_video', playerUri: uri, isGif: false };
    }

    // Spotify (detection only)
    if (host === 'open.spotify.com') {
      return { type: 'spotify_song', playerUri: uri, isGif: false };
    }

    return null;
  } catch {
    return null;
  }
}
