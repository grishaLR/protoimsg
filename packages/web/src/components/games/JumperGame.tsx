import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { useActorSprite } from '../../hooks/useActorSprite';
import { blobUrl } from '../../lib/record-blobs';
import { API_URL } from '../../lib/config';
import { JumperEngine, type JumperDeathInfo } from './JumperEngine';
import styles from './JumperGame.module.css';

interface JumperGameProps {
  onClose: () => void;
  onScore?: (score: number, difficulty: Difficulty) => void;
  did?: string;
  pds?: string;
  difficulty: Difficulty;
  practiceMode?: boolean;
}

export function JumperGame({
  onClose,
  onScore,
  did,
  pds,
  difficulty,
  practiceMode,
}: JumperGameProps) {
  const { data: sprite } = useActorSprite(did, pds);
  const { agent, did: viewerDid } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<JumperEngine | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

  const [sfxMuted, setSfxMuted] = useState(
    () => localStorage.getItem('protoimsg:sfx-muted') === 'true',
  );
  const [uiPhase, setUiPhase] = useState<'start' | 'playing' | 'dead'>('start');
  const [deathInfo, setDeathInfo] = useState<JumperDeathInfo | null>(null);

  // Fetch leaderboard
  useEffect(() => {
    const system = `jumper_${difficulty}`;
    const otherSystem = difficulty === 'faster' ? null : 'jumper_faster';
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

  // Load jetpack image from equipment record
  useEffect(() => {
    if (!pds || !did) return;
    fetch(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=equipment.rpg.item`)
      .then((r) => r.json())
      .then((data: { records: Array<{ value: Record<string, unknown> }> }) => {
        const rec = data.records.find((r) => r.value.item === 'jet_pack');
        if (!rec) return;
        const icon = rec.value.icon as { ref?: { $link: string } } | undefined;
        const cid = icon?.ref?.$link ?? (rec.value.assetCid as string | undefined);
        if (!cid) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = blobUrl(pds, did, cid);
        img.onload = () => {
          engineRef.current?.updateJetpackImg(img);
        };
      })
      .catch(() => {});
  }, [pds, did]);

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
    const engine = new JumperEngine(canvas, { difficulty, practiceMode });
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

  // Sync sfxMuted into engine
  useEffect(() => {
    engineRef.current?.setSfxMuted(sfxMuted);
  }, [sfxMuted]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>{difficulty} jumper</span>
        <div className={styles.headerActions}>
          <button
            className={styles.close}
            onClick={() => {
              setSfxMuted((m) => !m);
            }}
            aria-label="Toggle sound"
            type="button"
          >
            {sfxMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button className={styles.close} onClick={onClose} aria-label="Close game" type="button">
            ✕
          </button>
        </div>
      </div>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={352}
          height={520}
          className={styles.canvas}
          style={{ width: 352, height: 520 }}
        />
        {uiPhase === 'start' && (
          <div className={styles.overlay}>
            <span className={styles.overlayGameName}>{difficulty.toUpperCase()} JUMPER</span>
            <span className={styles.overlaySub}>← → / A D · tap left or right on mobile</span>
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
            <div className={styles.deathCauseGroup}>
              <span
                className={styles.deathTitle}
                style={{
                  color:
                    deathInfo.cause === 'blackhole'
                      ? '#a78bfa'
                      : deathInfo.cause === 'alien'
                        ? '#34d399'
                        : '#ef4444',
                }}
              >
                {deathInfo.cause === 'blackhole'
                  ? 'SPAGHETTIFIED'
                  : deathInfo.cause === 'alien'
                    ? 'ABDUCTED'
                    : 'YOU FELL'}
              </span>
              <span className={styles.deathSub}>
                {deathInfo.cause === 'blackhole'
                  ? 'consumed by the void'
                  : deathInfo.cause === 'alien'
                    ? 'taken by the aliens'
                    : 'into the abyss'}
              </span>
            </div>
            {deathInfo.result !== 'lose' && (
              <span
                className={styles.deathResult}
                style={{ color: deathInfo.result === 'leaderboard' ? '#fbbf24' : '#34d399' }}
              >
                {deathInfo.result === 'leaderboard' ? 'LEADERBOARD!' : 'NEW BEST!'}
              </span>
            )}
            <span className={styles.overlayScore}>SCORE {deathInfo.score}</span>
            <span className={styles.overlayBest}>BEST {deathInfo.hi}</span>
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
      <div className={styles.hint}>← → / A D · tap left or right side on mobile</div>
    </div>
  );
}
