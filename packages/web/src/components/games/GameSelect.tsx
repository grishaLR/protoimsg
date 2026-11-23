import { useEffect, useRef } from 'react';
import { HURDLES_ENABLED } from '../../lib/config';
import { GameIcon, type GAME_ICON_PATHS } from './GameLeaderboard';
import styles from './GameSelect.module.css';

export type GameId = 'hurdles' | 'hopper';
export type Difficulty = 'fast' | 'faster';

const GAMES: Record<GameId, { icon: keyof typeof GAME_ICON_PATHS; desc: string }> = {
  hurdles: { icon: 'run', desc: 'Jump the hurdles · beat your high score' },
  hopper: { icon: 'ufo', desc: "Jump up · don't fall · go higher" },
};

/** Games the viewer can reach. Hurdles sits behind HURDLES_ENABLED. */
export const AVAILABLE_GAMES: readonly GameId[] = HURDLES_ENABLED
  ? ['hurdles', 'hopper']
  : ['hopper'];

/**
 * Two-step game chooser shared by the Fun tab and the public /games page:
 * a landing with one button per game, then that game's difficulty screen.
 * With a single game available the landing is skipped.
 */
export function GameSelect({
  game,
  onPick,
  onLaunch,
}: {
  /** The game whose difficulty screen is open, or null for the landing. */
  game: GameId | null;
  onPick: (game: GameId | null) => void;
  onLaunch: (game: GameId, difficulty: Difficulty) => void;
}) {
  const onlyGame = AVAILABLE_GAMES.length === 1 ? AVAILABLE_GAMES[0] : undefined;
  const shown = game && AVAILABLE_GAMES.includes(game) ? game : (onlyGame ?? null);

  // The two steps swap whole subtrees, so the pressed button unmounts and focus
  // would fall to <body>. Move it along: to the back button when a game opens,
  // back to that game's card when returning to the landing.
  const rootRef = useRef<HTMLDivElement>(null);
  const prevShownRef = useRef(shown);
  useEffect(() => {
    const prev = prevShownRef.current;
    prevShownRef.current = shown;
    if (prev === shown) return;
    const target = shown
      ? rootRef.current?.querySelector('button')
      : rootRef.current?.querySelector(`button[data-game="${prev ?? ''}"]`);
    if (target instanceof HTMLElement) target.focus();
  }, [shown]);

  if (!shown) {
    return (
      <div className={styles.grid} ref={rootRef}>
        {AVAILABLE_GAMES.map((id) => (
          <button
            key={id}
            className={styles.gameCard}
            data-game={id}
            onClick={() => {
              onPick(id);
            }}
            type="button"
          >
            <span className={styles.gameIcon}>
              <GameIcon icon={GAMES[id].icon} size={40} />
            </span>
            <span className={styles.gameName}>{id}</span>
            <span className={styles.gameDesc}>{GAMES[id].desc}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.previewWrap} ref={rootRef}>
      {!onlyGame && (
        <button
          className={styles.backBtn}
          onClick={() => {
            onPick(null);
          }}
          type="button"
        >
          ← all games
        </button>
      )}
      <div className={styles.previewCanvas}>
        <div
          className={
            shown === 'hurdles' ? styles.gamePlaceholderHurdles : styles.gamePlaceholderHopper
          }
        />
        <div className={styles.diffOverlay}>
          <GameIcon icon={GAMES[shown].icon} size={64} />
          <span className={styles.diffOverlayGame}>{shown}</span>
          <span className={styles.diffOverlayHint}>choose difficulty</span>
          <div className={styles.diffBtns}>
            <button
              className={styles.diffBtn}
              onClick={() => {
                onLaunch(shown, 'fast');
              }}
              type="button"
            >
              fast
            </button>
            <button
              className={styles.diffBtn}
              onClick={() => {
                onLaunch(shown, 'faster');
              }}
              type="button"
            >
              faster
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
