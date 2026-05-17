import { useEffect, useRef, useState } from 'react';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { useActorSprite } from '../../hooks/useActorSprite';
import { blobUrl } from '../../lib/record-blobs';
import { API_URL } from '../../lib/config';
import { RunnerEngine, type RunnerDeathInfo } from './RunnerEngine';
import styles from './RunnerGame.module.css';

interface RunnerGameProps {
  onClose: () => void;
  onScore?: (score: number, difficulty: Difficulty) => void;
  did?: string;
  pds?: string;
  difficulty: Difficulty;
  practiceMode?: boolean;
}

export function RunnerGame({
  onClose,
  onScore,
  did,
  pds,
  difficulty,
  practiceMode,
}: RunnerGameProps) {
  const { data: sprite } = useActorSprite(did, pds);
  const { agent, did: viewerDid } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RunnerEngine | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

  const [uiPhase, setUiPhase] = useState<'start' | 'playing' | 'dead'>('start');
  const [deathInfo, setDeathInfo] = useState<RunnerDeathInfo | null>(null);

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
    const system = `runner_${difficulty}`;
    const otherSystem = difficulty === 'faster' ? null : 'runner_faster';
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

  // Load actor sprite image
  useEffect(() => {
    if (!sprite?.spriteSheet.ref.$link || !pds || !did) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = blobUrl(pds, did, sprite.spriteSheet.ref.$link);
    img.onload = () => {
      imgRef.current = img;
      engineRef.current?.updateActor(sprite, img);
    };
  }, [sprite, pds, did]);

  // Push auth updates into engine
  useEffect(() => {
    engineRef.current?.updateAuth(agent ?? null, viewerDid ?? null);
  }, [agent, viewerDid]);

  // Create / recreate engine when difficulty changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new RunnerEngine(canvas, { difficulty, practiceMode });
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
    if (imgRef.current && sprite) engine.updateActor(sprite, imgRef.current);
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
        <span className={styles.title}>{difficulty} runner</span>
        <div className={styles.headerActions}>
          <button className={styles.close} onClick={onClose} aria-label="Close game" type="button">
            ✕
          </button>
        </div>
      </div>
      <div ref={canvasContainerRef} className={styles.canvasContainer}>
        <canvas ref={canvasRef} width={680} height={240} className={styles.canvas} />
        {uiPhase === 'start' && (
          <div className={styles.overlay}>
            <span className={styles.overlayGameName}>{difficulty.toUpperCase()} RUNNER</span>
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
