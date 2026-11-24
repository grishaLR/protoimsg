import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { makeSeed, type HurdlesInputLog } from '@protoimsg/game-sim';
import type { Agent } from '@atproto/api';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { useGameStatus } from '../../hooks/useGameStatus';
import { NORMALIZED_SPRITE, currentSpriteUrl } from '../../lib/actor-sprite';
import { authFetch } from '../../lib/api';
import { API_URL } from '../../lib/config';
import {
  HurdlesEngine,
  HURDLES_CANVAS_W,
  HURDLES_CANVAS_H,
  type HurdlesDeathInfo,
  type HurdlesRun,
} from './HurdlesEngine';
import { ShareStatusToggle } from './ShareStatusToggle';
import styles from './HurdlesGame.module.css';

interface HurdlesGameProps {
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
async function writeHurdlesStats(
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
    const existingGame = existingStats.hurdles as Record<string, unknown> | undefined;
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
        hurdles: {
          ...(existingGame ?? {}),
          _meta: { name: 'hurdles' },
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

export function HurdlesGame({ onClose, onScore, did, difficulty, practiceMode }: HurdlesGameProps) {
  const { agent, did: viewerDid, refreshGifts } = useAuth();
  const status = useGameStatus('hurdles', difficulty, practiceMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HurdlesEngine | null>(null);
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
  const [deathInfo, setDeathInfo] = useState<HurdlesDeathInfo | null>(null);
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
      body: JSON.stringify({ system: `hurdles_${difficulty}` }),
    });
    if (!res.ok) throw new Error('failed to start run');
    const data = (await res.json()) as { runId: string; seed: number };
    return { seed: data.seed, runId: data.runId };
  }, [practiceMode, difficulty]);

  // Submit a finished authed run for server-side replay validation. The server
  // recomputes the score from the jump log — the number here is never sent.
  const submitRun = useCallback(
    (run: HurdlesRun) => {
      const runId = ticketRef.current?.runId;
      if (!runId) return;
      void authFetch('/api/games/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, inputLog: run.inputLog satisfies HurdlesInputLog }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          // A run that reaches the leaderboard earns the Hermes Shoes. The
          // server has written that `equipment.rpg.give` by the time it
          // answers, so accept it now and the unlock modal shows right away.
          const data = (await res.json()) as { gifted?: boolean };
          if (data.gifted) refreshGifts();
        })
        .catch(() => {});
      if (agent && viewerDid) void writeHurdlesStats(agent, viewerDid, run.score, difficulty);
    },
    [agent, viewerDid, difficulty, refreshGifts],
  );
  const submitRunRef = useRef(submitRun);
  submitRunRef.current = submitRun;
  const markRunEndedRef = useRef(status.markRunEnded);
  markRunEndedRef.current = status.markRunEnded;
  // Read at engine-creation time, which is after an async ticket fetch.
  const authRef = useRef({ agent, viewerDid });
  authRef.current = { agent, viewerDid };
  const sfxMutedRef = useRef(sfxMuted);
  sfxMutedRef.current = sfxMuted;
  // Bumped to rebuild the engine when the very first ticket failed.
  const [attempt, setAttempt] = useState(0);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  // Scale canvas to fit container on narrow screens
  useEffect(() => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const apply = () => {
      const scale = Math.min(1, container.clientWidth / HURDLES_CANVAS_W);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';
      container.style.height = `${HURDLES_CANVAS_H * scale}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Create the engine once per difficulty, after the first ticket is acquired.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: HurdlesEngine | null = null;
    let cancelled = false;
    setUiPhase('loading');
    setDeathInfo(null);
    acquireTicket()
      .then((ticket) => {
        if (cancelled || !canvasRef.current) return;
        ticketRef.current = ticket;
        engine = new HurdlesEngine(canvasRef.current, {
          difficulty,
          practiceMode,
          seed: ticket.seed,
        });
        engine.onDeath = (info) => {
          setDeathInfo(info);
          setUiPhase('dead');
        };
        engine.onScore = (score, diff) => {
          markRunEndedRef.current();
          onScoreRef.current?.(score, diff);
        };
        engine.onSubmitRun = (run) => {
          submitRunRef.current(run);
        };
        engine.onClose = () => {
          onCloseRef.current();
        };
        engine.updateAuth(authRef.current.agent ?? null, authRef.current.viewerDid ?? null);
        engine.updateLeaderboard(leaderboardRef.current);
        if (imgRef.current) engine.updateActor(NORMALIZED_SPRITE, imgRef.current);
        // The mute button may have been toggled while the ticket was loading.
        engine.setSfxMuted(sfxMutedRef.current);
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
  }, [difficulty, practiceMode, attempt]); // sprite/auth pushed via refs + separate effects

  // Fetch leaderboard — for the "you made the board" result on the death
  // screen. Practice runs never reach the board, and the practice path must
  // work offline, so it makes no request.
  useEffect(() => {
    if (practiceMode) return;
    const ac = new AbortController();
    const system = `hurdles_${difficulty}`;
    const otherSystem = difficulty === 'faster' ? null : 'hurdles_faster';
    type Board = { entries: { did: string; score: number }[] };
    const load = (s: string) =>
      fetch(`${API_URL}/api/games/leaderboard/${s}`, { signal: ac.signal }).then(
        (r) => r.json() as Promise<Board>,
      );
    Promise.allSettled([
      load(system),
      otherSystem ? load(otherSystem) : Promise.resolve<Board>({ entries: [] }),
    ])
      .then(([ownRes, fasterRes]) => {
        if (ac.signal.aborted) return;
        const own = ownRes.status === 'fulfilled' ? ownRes.value.entries : [];
        const fasterDids = new Set(
          (fasterRes.status === 'fulfilled' ? fasterRes.value.entries : []).map((e) => e.did),
        );
        const entries = own.filter((e) => !fasterDids.has(e.did));
        leaderboardRef.current = entries;
        engineRef.current?.updateLeaderboard(entries);
      })
      .catch(() => {});
    return () => {
      ac.abort();
    };
  }, [difficulty, practiceMode]);

  // Load the actor sprite from rpg.actor's normalized endpoint (see
  // lib/actor-sprite) — the same source the town uses, so a sprite that renders
  // in the town renders here too. Needs only the did. Without a sprite, the
  // leaderboard game asks you to make a character; practice (which must work
  // offline) just plays with the engine's built-in stand-in.
  useEffect(() => {
    const noSprite = practiceMode ? 'ok' : 'missing';
    if (!did) {
      setSpriteStatus(noSprite);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      engineRef.current?.updateActor(NORMALIZED_SPRITE, img);
      setSpriteStatus('ok');
    };
    // 404 / load failure → the user has no rpg.actor character.
    img.onerror = () => {
      if (!cancelled) setSpriteStatus(noSprite);
    };
    // Versioned by the current sprite, so a just-changed one shows at once.
    currentSpriteUrl(did)
      .then((url) => {
        if (!cancelled) img.src = url;
      })
      .catch(() => {
        if (!cancelled) setSpriteStatus(noSprite);
      });
    return () => {
      cancelled = true;
    };
  }, [did, practiceMode]);

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
    status.markPlaying();
    setUiPhase('playing');
  };

  // Keyboard players: put focus on the overlay's main button, so Enter/Space
  // starts or restarts without tabbing through the app. Delayed on the death
  // screen so a jump key mashed at the moment of impact can't restart at once.
  const startReady = uiPhase === 'start' && spriteStatus === 'ok';
  useEffect(() => {
    if (!startReady && uiPhase !== 'dead' && uiPhase !== 'error') return;
    const timer = setTimeout(
      () => {
        primaryBtnRef.current?.focus();
      },
      uiPhase === 'dead' ? 700 : 0,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [uiPhase, startReady]);

  const handleRetry = () => {
    setUiPhase('loading');
    setDeathInfo(null);
    // No engine means the first ticket never arrived: build it from scratch.
    if (!engineRef.current) {
      setAttempt((n) => n + 1);
      return;
    }
    acquireTicket()
      .then((ticket) => {
        if (!mountedRef.current || !engineRef.current) return;
        ticketRef.current = ticket;
        engineRef.current.restart(ticket.seed);
        status.markPlaying();
        setUiPhase('playing');
      })
      .catch(() => {
        if (mountedRef.current) setUiPhase('error');
      });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>{difficulty} hurdles</span>
        <div className={styles.headerActions}>
          <button
            className={styles.close}
            onClick={() => {
              setSfxMuted((m) => !m);
            }}
            aria-label="Mute sound"
            aria-pressed={sfxMuted}
            type="button"
          >
            {sfxMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button className={styles.close} onClick={onClose} aria-label="Close game" type="button">
            ✕
          </button>
        </div>
      </div>
      <div
        ref={canvasContainerRef}
        className={`${styles.canvasContainer} ${
          uiPhase === 'playing' ? '' : styles.canvasContainerOverlay
        }`}
      >
        <canvas
          ref={canvasRef}
          width={HURDLES_CANVAS_W}
          height={HURDLES_CANVAS_H}
          className={styles.canvas}
        />
        {uiPhase === 'loading' && (
          <div className={styles.overlay} role="status">
            <span className={styles.overlaySub}>loading…</span>
          </div>
        )}
        {uiPhase === 'error' && (
          <div className={styles.overlay} role="status">
            <span className={styles.overlayGameName}>CONNECTION LOST</span>
            <span className={styles.overlaySub}>couldn&apos;t reach the arcade</span>
            <div className={styles.overlayCtas}>
              <button className={styles.overlayBtnSecondary} type="button" onClick={onClose}>
                Leave
              </button>
              <button
                ref={primaryBtnRef}
                className={styles.overlayBtn}
                type="button"
                onClick={handleRetry}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {uiPhase === 'start' && spriteStatus === 'pending' && (
          <div className={styles.overlay} role="status">
            <span className={styles.overlaySub}>loading your character…</span>
          </div>
        )}
        {uiPhase === 'start' && spriteStatus === 'missing' && (
          <div className={styles.overlay} role="status">
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
          <div className={styles.overlay} role="status">
            <span className={styles.overlayGameName}>{difficulty.toUpperCase()} HURDLES</span>
            <span className={styles.overlaySub}>
              ↑ / SPACE or tap to jump · jump again in the air to double jump
            </span>
            <span className={styles.overlaySub}>
              hop the flowers · jump the low UFOs · run under the high ones
            </span>
            <button
              ref={primaryBtnRef}
              className={styles.overlayBtn}
              type="button"
              onClick={handlePlay}
            >
              PLAY
            </button>
            <ShareStatusToggle status={status} />
          </div>
        )}
        {uiPhase === 'dead' && deathInfo && (
          <div className={styles.overlay} role="status">
            <div className={styles.deathCauseGroup}>
              <span
                className={`${styles.deathTitle} ${
                  deathInfo.cause === 'ufo' ? styles.deathTitleUfo : styles.deathTitleFlower
                }`}
              >
                {deathInfo.cause === 'ufo' ? 'ABDUCTED' : 'TRIPPED'}
              </span>
              <span className={styles.deathSub}>
                {deathInfo.cause === 'ufo' ? 'taken by the aliens' : 'face-first into a flower'}
              </span>
            </div>
            {deathInfo.result !== 'lose' && (
              <span
                className={`${styles.deathResult} ${
                  deathInfo.result === 'leaderboard'
                    ? styles.deathResultBoard
                    : styles.deathResultBest
                }`}
              >
                {deathInfo.result === 'leaderboard' ? 'LEADERBOARD!' : 'NEW BEST!'}
              </span>
            )}
            <span className={styles.overlayScore}>
              SCORE {deathInfo.score} · BEST {deathInfo.hi}
            </span>
            {deathInfo.rank !== null && deathInfo.rank <= 5 && (
              <span className={styles.overlayRank}>you&apos;re #{deathInfo.rank} on the board</span>
            )}
            <div className={styles.overlayCtas}>
              <button className={styles.overlayBtnSecondary} type="button" onClick={onClose}>
                Leave
              </button>
              <button
                ref={primaryBtnRef}
                className={styles.overlayBtn}
                type="button"
                onClick={handleRetry}
              >
                Try Again
              </button>
            </div>
            <ShareStatusToggle status={status} />
          </div>
        )}
      </div>
      <div className={styles.hint}>↑ / SPACE jump · double jump in the air · ESC exit</div>
    </div>
  );
}
