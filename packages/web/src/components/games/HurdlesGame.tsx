import { useEffect, useRef, useState } from 'react';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { NORMALIZED_SPRITE, normalizedSpriteUrl } from '../../lib/actor-sprite';
import { API_URL } from '../../lib/config';
import { HurdlesEngine, type HurdlesDeathInfo } from './HurdlesEngine';
import styles from './HurdlesGame.module.css';

interface HurdlesGameProps {
  onClose: () => void;
  onScore?: (score: number, difficulty: Difficulty) => void;
  did?: string;
  pds?: string;
  difficulty: Difficulty;
  practiceMode?: boolean;
}

export function HurdlesGame({ onClose, onScore, did, difficulty, practiceMode }: HurdlesGameProps) {
  const { agent, did: viewerDid } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HurdlesEngine | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

  const [uiPhase, setUiPhase] = useState<'start' | 'playing' | 'dead'>('start');
  const [deathInfo, setDeathInfo] = useState<HurdlesDeathInfo | null>(null);
  // Sprite gate: the game can't be started until the actor sprite resolves.
  // 'missing' = no rpg.actor character — the player can never play without one.
  const [spriteStatus, setSpriteStatus] = useState<'pending' | 'ok' | 'missing'>('pending');

  // Scale canvas to fit container on narrow screens
  useEffect(() => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const apply = () => {
      const scale = Math.min(1, container.clientWidth / 680);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';
      container.style.height = `${240 * scale}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Fetch leaderboard
  useEffect(() => {
    const system = `hurdles_${difficulty}`;
    const otherSystem = difficulty === 'faster' ? null : 'hurdles_faster';
    Promise.allSettled([
      fetch(`${API_URL}/api/games/leaderboard/${system}`).then(
        (r) => r.json() as Promise<{ entries: { did: string; score: number }[] }>,
      ),
      otherSystem
        ? fetch(`${API_URL}/api/games/leaderboard/${otherSystem}`).then(
            (r) => r.json() as Promise<{ entries: { did: string; score: number }[] }>,
          )
        : Promise.resolve({ entries: [] as { did: string; score: number }[] }),
    ])
      .then(([ownRes, fasterRes]) => {
        const own = ownRes.status === 'fulfilled' ? ownRes.value.entries : [];
        const fasterDids = new Set(
          (fasterRes.status === 'fulfilled' ? fasterRes.value.entries : []).map((e) => e.did),
        );
        const entries = own.filter((e) => !fasterDids.has(e.did));
        leaderboardRef.current = entries;
        engineRef.current?.updateLeaderboard(entries);
      })
      .catch(() => {});
  }, [difficulty]);

  // Load the actor sprite from rpg.actor's normalized endpoint (see
  // lib/actor-sprite) — the same source the town uses, so a sprite that renders
  // in the town renders here too. Needs only the did; on failure (no rpg.actor
  // character) onload never fires and the engine draws its procedural fallback.
  useEffect(() => {
    if (!did) {
      setSpriteStatus('missing');
      return;
    }
    const img = new Image();
    img.src = normalizedSpriteUrl(did);
    img.onload = () => {
      imgRef.current = img;
      engineRef.current?.updateActor(NORMALIZED_SPRITE, img);
      setSpriteStatus('ok');
    };
    // 404 / load failure → the user has no rpg.actor character.
    img.onerror = () => {
      setSpriteStatus('missing');
    };
  }, [did]);

  // Push auth updates into engine
  useEffect(() => {
    engineRef.current?.updateAuth(agent ?? null, viewerDid ?? null);
  }, [agent, viewerDid]);

  // Create / recreate engine when difficulty changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new HurdlesEngine(canvas, { difficulty, practiceMode });
    engine.onDeath = (info) => {
      setDeathInfo(info);
      setUiPhase('dead');
    };
    engine.onScore = (score, diff) => onScoreRef.current?.(score, diff);
    engine.onClose = () => {
      onCloseRef.current();
    };
    engine.updateAuth(agent ?? null, viewerDid ?? null);
    engine.updateLeaderboard(leaderboardRef.current);
    if (imgRef.current) engine.updateActor(NORMALIZED_SPRITE, imgRef.current);
    engineRef.current = engine;
    setUiPhase('start');
    setDeathInfo(null);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [difficulty]); // practiceMode/agent/viewerDid/sprite accessed via refs or separate effects

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>{difficulty} hurdles</span>
        <div className={styles.headerActions}>
          <button className={styles.close} onClick={onClose} aria-label="Close game" type="button">
            ✕
          </button>
        </div>
      </div>
      <div ref={canvasContainerRef} className={styles.canvasContainer}>
        <canvas ref={canvasRef} width={680} height={240} className={styles.canvas} />
        {uiPhase === 'start' && spriteStatus === 'pending' && (
          <div className={styles.overlay}>
            <span className={styles.overlaySub}>loading your character…</span>
          </div>
        )}
        {uiPhase === 'start' && spriteStatus === 'missing' && (
          <div className={styles.overlay}>
            <span className={styles.overlayGameName}>No character yet</span>
            <span className={styles.overlaySub}>
              Create a pixel character at rpg.actor, or play the open arcade with a ready-made one.
            </span>
            <div className={styles.overlayCtas}>
              <button
                className={styles.overlayBtnSecondary}
                type="button"
                onClick={() => {
                  window.location.href = '/games';
                }}
              >
                Open the arcade
              </button>
              <button
                className={styles.overlayBtn}
                type="button"
                onClick={() => {
                  window.open('https://rpg.actor/generator', '_blank', 'noopener,noreferrer');
                }}
              >
                Create a character
              </button>
            </div>
          </div>
        )}
        {uiPhase === 'start' && spriteStatus === 'ok' && (
          <div className={styles.overlay}>
            <span className={styles.overlayGameName}>{difficulty.toUpperCase()} HURDLES</span>
            <span className={styles.overlaySub}>
              ↑ / SPACE or click to jump · double jump · dodge the cacti
            </span>
            <button
              className={styles.overlayBtn}
              type="button"
              onClick={() => {
                engineRef.current?.startGame();
                setUiPhase('playing');
              }}
            >
              PLAY
            </button>
          </div>
        )}
        {uiPhase === 'dead' && deathInfo && (
          <div className={styles.overlay}>
            <span
              className={styles.deathTitle}
              style={{
                color:
                  deathInfo.result === 'leaderboard'
                    ? '#fbbf24'
                    : deathInfo.result === 'best'
                      ? '#34d399'
                      : '#ef4444',
              }}
            >
              {deathInfo.result === 'leaderboard'
                ? 'LEADERBOARD!'
                : deathInfo.result === 'best'
                  ? 'NEW BEST!'
                  : 'GAME OVER'}
            </span>
            {deathInfo.result !== 'lose' && (
              <span className={styles.deathSub}>
                {deathInfo.result === 'leaderboard' ? 'you cracked the top 5' : 'personal record'}
              </span>
            )}
            <span className={styles.overlayScore}>
              Score: {deathInfo.score} Best: {deathInfo.hi}
            </span>
            {deathInfo.rank !== null && deathInfo.rank <= 5 && (
              <span className={styles.overlayRank}>you're #{deathInfo.rank} on the board</span>
            )}
            <div className={styles.overlayCtas}>
              <button className={styles.overlayBtnSecondary} type="button" onClick={onClose}>
                Leave
              </button>
              <button
                className={styles.overlayBtn}
                type="button"
                onClick={() => {
                  engineRef.current?.restart();
                  setUiPhase('playing');
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={styles.hint}>↑ / SPACE jump · double jump · ESC exit</div>
    </div>
  );
}
