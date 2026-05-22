import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { makeSeed, type HopperInputLog } from '@protoimsg/game-sim';
import type { Agent } from '@atproto/api';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { NORMALIZED_SPRITE, normalizedSpriteUrl } from '../../lib/actor-sprite';
import { blobUrl } from '../../lib/record-blobs';
import { authFetch } from '../../lib/api';
import { API_URL } from '../../lib/config';
import { HopperEngine, type HopperDeathInfo, type HopperRun } from './HopperEngine';
import styles from './HopperGame.module.css';

interface HopperGameProps {
  onClose: () => void;
  onScore?: (score: number, difficulty: Difficulty) => void;
  did?: string;
  pds?: string;
  difficulty: Difficulty;
  practiceMode?: boolean;
}

interface RunTicket {
  seed: number;
  runId?: string;
}

/** Writes the player's self-reported personal stats to their own repo. */
async function writeHopperStats(
  agent: Agent,
  viewerDid: string,
  score: number,
  difficulty: string,
) {
  try {
    const statsRes = await agent.com.atproto.repo
      .getRecord({ repo: viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
      .catch(() => null);
    const existingStats: Record<string, unknown> = statsRes
      ? (statsRes.data.value as Record<string, unknown>)
      : {};
    const existingGame = existingStats.hopper as Record<string, unknown> | undefined;
    const prev = existingGame?.[difficulty] as
      | { best?: number; tries?: number; worst?: number }
      | undefined;
    const now = new Date().toISOString();
    await agent.com.atproto.repo.putRecord({
      repo: viewerDid,
      collection: 'actor.rpg.stats',
      rkey: 'self',
      record: {
        ...existingStats,
        $type: 'actor.rpg.stats',
        hopper: {
          ...(existingGame ?? {}),
          _meta: { name: 'hopper' },
          [difficulty]: {
            best: Math.max(score, prev?.best ?? 0),
            tries: (prev?.tries ?? 0) + 1,
            worst: prev ? Math.min(score, prev.worst ?? score) : score,
          },
        },
        updatedAt: now,
        ...(existingStats.createdAt ? {} : { createdAt: now }),
      },
    });
  } catch {
    /* silently fail — personal stats are cosmetic */
  }
}

export function HopperGame({
  onClose,
  onScore,
  did,
  pds,
  difficulty,
  practiceMode,
}: HopperGameProps) {
  const { agent, did: viewerDid } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<HopperEngine | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const ticketRef = useRef<RunTicket | null>(null);
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

  const [sfxMuted, setSfxMuted] = useState(
    () => localStorage.getItem('protoimsg:sfx-muted') === 'true',
  );
  const [uiPhase, setUiPhase] = useState<'loading' | 'start' | 'playing' | 'dead' | 'error'>(
    'loading',
  );
  const [deathInfo, setDeathInfo] = useState<HopperDeathInfo | null>(null);
  // Sprite gate: the game can't be started until the actor sprite resolves.
  // 'missing' = no rpg.actor character — the player can never play without one.
  const [spriteStatus, setSpriteStatus] = useState<'pending' | 'ok' | 'missing'>('pending');

  // Acquire a run ticket. Practice runs pick a local seed (works offline);
  // authed runs ask the server for a seed + single-use runId.
  const acquireTicket = useCallback(async (): Promise<RunTicket> => {
    if (practiceMode) return { seed: makeSeed() };
    const res = await authFetch('/api/games/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: `hopper_${difficulty}` }),
    });
    if (!res.ok) throw new Error('failed to start run');
    const data = (await res.json()) as { runId: string; seed: number };
    return { seed: data.seed, runId: data.runId };
  }, [practiceMode, difficulty]);

  // Submit a finished authed run for server-side replay validation.
  const submitRun = useCallback(
    (run: HopperRun) => {
      const runId = ticketRef.current?.runId;
      if (!runId) return;
      void authFetch('/api/games/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, inputLog: run.inputLog satisfies HopperInputLog }),
      }).catch(() => {});
      if (agent && viewerDid) void writeHopperStats(agent, viewerDid, run.score, difficulty);
    },
    [agent, viewerDid, difficulty],
  );

  // Create the engine once per difficulty, after the first ticket is acquired.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: HopperEngine | null = null;
    let cancelled = false;
    setUiPhase('loading');
    setDeathInfo(null);
    acquireTicket()
      .then((ticket) => {
        if (cancelled || !canvasRef.current) return;
        ticketRef.current = ticket;
        engine = new HopperEngine(canvasRef.current, {
          difficulty,
          practiceMode,
          seed: ticket.seed,
        });
        engine.onDeath = (info) => {
          setDeathInfo(info);
          setUiPhase('dead');
        };
        engine.onScore = (score, diff) => onScoreRef.current?.(score, diff);
        engine.onSubmitRun = submitRun;
        engine.onClose = () => {
          onCloseRef.current();
        };
        engine.updateAuth(agent ?? null, viewerDid ?? null);
        engine.updateLeaderboard(leaderboardRef.current);
        if (imgRef.current) engine.updateActor(NORMALIZED_SPRITE, imgRef.current);
        engine.setSfxMuted(localStorage.getItem('protoimsg:sfx-muted') === 'true');
        engineRef.current = engine;
        setUiPhase('start');
      })
      .catch(() => {
        if (!cancelled) setUiPhase('error');
      });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [difficulty, practiceMode]); // sprite/auth pushed via refs + separate effects

  // Fetch leaderboard
  useEffect(() => {
    const system = `hopper_${difficulty}`;
    const otherSystem = difficulty === 'faster' ? null : 'hopper_faster';
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
        // No crossOrigin: this is a Canvas 2D game and never reads the canvas
        // back, so a "tainted" canvas is harmless — whereas setting crossOrigin
        // hard-fails the load for any PDS that omits CORS headers.
        const img = new Image();
        img.src = blobUrl(pds, did, cid);
        img.onload = () => {
          engineRef.current?.updateJetpackImg(img);
        };
      })
      .catch(() => {});
  }, [pds, did]);

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

  // Sync sfxMuted into engine
  useEffect(() => {
    engineRef.current?.setSfxMuted(sfxMuted);
  }, [sfxMuted]);

  // Track mount state so async run-ticket callbacks don't touch a dead component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handlePlay = () => {
    engineRef.current?.startGame();
    setUiPhase('playing');
  };

  const handleRetry = () => {
    setUiPhase('loading');
    setDeathInfo(null);
    acquireTicket()
      .then((ticket) => {
        if (!mountedRef.current || !engineRef.current) return;
        ticketRef.current = ticket;
        engineRef.current.restart(ticket.seed);
        setUiPhase('playing');
      })
      .catch(() => {
        if (mountedRef.current) setUiPhase('error');
      });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>{difficulty} hopper</span>
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
        {uiPhase === 'loading' && (
          <div className={styles.overlay}>
            <span className={styles.overlaySub}>loading…</span>
          </div>
        )}
        {uiPhase === 'error' && (
          <div className={styles.overlay}>
            <span className={styles.overlayGameName}>CONNECTION LOST</span>
            <span className={styles.overlaySub}>couldn't reach the arcade</span>
            <div className={styles.overlayCtas}>
              <button className={styles.overlayBtnSecondary} type="button" onClick={onClose}>
                Leave
              </button>
              <button className={styles.overlayBtn} type="button" onClick={handleRetry}>
                Retry
              </button>
            </div>
          </div>
        )}
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
            <span className={styles.overlayGameName}>{difficulty.toUpperCase()} HOPPER</span>
            <span className={styles.overlaySub}>← → / A D · tap left or right on mobile</span>
            <button className={styles.overlayBtn} type="button" onClick={handlePlay}>
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
              <button className={styles.overlayBtn} type="button" onClick={handleRetry}>
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
