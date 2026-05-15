import { useEffect, useRef } from 'react';
import type { Difficulty } from './GamesPanel';
import { Agent } from '@atproto/api';
import { useAuth } from '../../hooks/useAuth';
import { useActorSprite } from '../../hooks/useActorSprite';
import { blobUrl } from '../../lib/record-blobs';
import { authFetch } from '../../lib/api';
import { API_URL } from '../../lib/config';
import styles from './RunnerGame.module.css';

interface RunnerStats {
  _meta?: { name: string };
  best: number;
  tries: number;
  worst: number;
}

async function writeRunnerStats(agent: Agent, viewerDid: string, score: number, system: string) {
  try {
    const idx = system.indexOf('_');
    const base = idx === -1 ? system : system.slice(0, idx);
    const difficulty = idx === -1 ? 'default' : system.slice(idx + 1);

    const statsRes = await agent.com.atproto.repo
      .getRecord({
        repo: viewerDid,
        collection: 'actor.rpg.stats',
        rkey: 'self',
      })
      .catch(() => null);

    const existingStats: Record<string, unknown> = statsRes
      ? (statsRes.data.value as Record<string, unknown>)
      : {};

    const existingGame = existingStats[base] as Record<string, unknown> | undefined;
    const prev = existingGame?.[difficulty] as RunnerStats | undefined;
    const now = new Date().toISOString();
    const updatedDifficulty: RunnerStats = {
      best: Math.max(score, prev?.best ?? 0),
      tries: (prev?.tries ?? 0) + 1,
      worst: prev ? Math.min(score, prev.worst) : score,
    };

    await agent.com.atproto.repo.putRecord({
      repo: viewerDid,
      collection: 'actor.rpg.stats',
      rkey: 'self',
      record: {
        ...existingStats,
        $type: 'actor.rpg.stats',
        [base]: {
          ...(existingGame ?? {}),
          _meta: { name: `proto IM ${base}` },
          [difficulty]: updatedDifficulty,
        },
        updatedAt: now,
        ...(existingStats.createdAt ? {} : { createdAt: now }),
      },
    });
  } catch {
    // Silently fail — scores shouldn't block gameplay
  }
}

interface RunnerGameProps {
  onClose: () => void;
  onScore?: (score: number, difficulty: Difficulty) => void;
  did: string;
  pds: string;
  difficulty: Difficulty;
}

export function RunnerGame({ onClose, onScore, did, pds, difficulty }: RunnerGameProps) {
  const { data: sprite } = useActorSprite(did, pds);
  const { agent, did: viewerDid } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const scoreWrittenRef = useRef(false);

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

  useEffect(() => {
    if (!sprite?.spriteSheet.ref.$link) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = blobUrl(pds, did, sprite.spriteSheet.ref.$link);
    img.onload = () => {
      imgRef.current = img;
    };
  }, [sprite, pds, did]);

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
        : Promise.resolve({ entries: [] }),
    ])
      .then(([ownRes, fasterRes]) => {
        const own = ownRes.status === 'fulfilled' ? ownRes.value.entries : [];
        const fasterDids = new Set(
          (fasterRes.status === 'fulfilled' ? fasterRes.value.entries : []).map((e) => e.did),
        );
        // exclude DIDs already on the prestige (faster) leaderboard from fast leaderboard
        leaderboardRef.current = own.filter((e) => !fasterDids.has(e.did));
      })
      .catch(() => {
        /* non-critical */
      });
  }, [difficulty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    scoreWrittenRef.current = false;

    const system = `runner_${difficulty}`;
    const initSpeed = difficulty === 'faster' ? 11 : 7.5;
    const initSpawnIn = difficulty === 'faster' ? 60 : 90;

    const CW = 680;
    const CH = 240;
    const GROUND = CH - 40;
    const PX = 80;
    const GRAVITY = 0.55;
    const JUMP_V = -13;
    const SCALE = 2;
    const FW = (sprite?.frameWidth ?? 24) * SCALE;
    const FH = (sprite?.frameHeight ?? 24) * SCALE;
    const COLS = sprite?.columns ?? 3;

    const STARS = Array.from({ length: 60 }, () => ({
      x: Math.random() * CW,
      y: Math.random() * (GROUND - 10),
      size: Math.random() > 0.85 ? 2 : 1,
      brightness: 0.3 + Math.random() * 0.7,
      speed: 0.2 + Math.random() * 0.4, // parallax layer — slower than ground
    }));

    const st = {
      y: 0,
      vy: 0,
      grounded: true,
      dj: false,
      obs: [] as { x: number; w: number; h: number }[],
      score: 0,
      speed: initSpeed,
      frame: 0,
      tick: 0,
      dead: false,
      started: false,
      spawnIn: initSpawnIn,
      hi: 0,
      prevHi: 0,
      deathResult: 'lose' as 'leaderboard' | 'best' | 'lose',
    };

    // Async-fetch existing best from protocol so in-game HI display is accurate
    if (agent && viewerDid) {
      agent.com.atproto.repo
        .getRecord({ repo: viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.runner as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[difficulty] as { best?: number } | undefined;
          st.hi = dd?.best ?? 0;
          st.prevHi = st.hi;
        })
        .catch(() => {});
    }

    const tryJump = () => {
      if (!st.started) {
        st.started = true;
        return;
      }
      if (st.dead) {
        reset();
        return;
      }
      if (st.grounded) {
        st.vy = JUMP_V;
        st.grounded = false;
        st.dj = false;
      } else if (!st.dj) {
        st.vy = JUMP_V * 0.85;
        st.dj = true;
      }
    };

    const reset = () => {
      scoreWrittenRef.current = false;

      st.prevHi = st.hi;
      Object.assign(st, {
        y: 0,
        vy: 0,
        grounded: true,
        dj: false,
        obs: [],
        score: 0,
        speed: initSpeed,
        frame: 0,
        tick: 0,
        dead: false,
        started: false,
        spawnIn: initSpawnIn,
        deathResult: 'lose',
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === ' ') {
        e.preventDefault();
        tryJump();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('click', tryJump);

    const drawPlayer = () => {
      const img = imgRef.current;
      const py = GROUND - FH - st.y;
      if (img && sprite) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          img,
          st.frame * sprite.frameWidth,
          2 * sprite.frameHeight,
          sprite.frameWidth,
          sprite.frameHeight,
          PX,
          py,
          FW,
          FH,
        );
      } else {
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect(PX + 4, py + 8, FW - 8, FH - 8);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(PX + 6, py, FW - 12, Math.round(FH * 0.45));
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(PX + 10, py + 4, 4, 4);
        ctx.fillRect(PX + FW - 18, py + 4, 4, 4);
      }
    };

    const drawCactus = (x: number, w: number, h: number) => {
      ctx.fillStyle = '#2d6a27';
      const sw = Math.max(4, Math.round(w * 0.36));
      const sx = x + (w - sw) / 2;
      ctx.fillRect(sx, GROUND - h, sw, h);
      if (h > 24) {
        const aw = Math.round(w * 0.32);
        const at = Math.round(h * 0.32);
        const ah = Math.round(h * 0.38);
        ctx.fillRect(x, GROUND - h + at, aw, sw);
        ctx.fillRect(x, GROUND - h + at - ah, aw, ah);
        ctx.fillRect(x + w - aw, GROUND - h + at + 10, aw, sw);
        ctx.fillRect(
          x + w - aw,
          GROUND - h + at + 10 - Math.round(ah * 0.65),
          aw,
          Math.round(ah * 0.65),
        );
      }
    };

    let raf = 0;
    let lastFrameTime = 0;
    const FRAME_MS = 1000 / 60;
    const loop = (now: number) => {
      if (now - lastFrameTime < FRAME_MS - 1) {
        raf = requestAnimationFrame(loop);
        return;
      }
      lastFrameTime = now;
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, CW, CH);
      if (st.started && !st.dead) {
        for (const s of STARS) {
          s.x -= st.speed * s.speed;
          if (s.x < -2) s.x += CW + 2;
        }
      }
      for (const s of STARS) {
        ctx.globalAlpha = s.brightness;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, GROUND, CW, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, GROUND + 2, CW, CH - GROUND - 2);

      if (!st.started) {
        drawPlayer();
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PRESS SPACE / ↑ OR CLICK TO START', CW / 2, CH / 2 - 28);
        ctx.fillStyle = '#64748b';
        ctx.font = '12px monospace';
        ctx.fillText('double jump enabled · dodge the cacti', CW / 2, CH / 2 - 6);
        if (st.hi > 0) {
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(`Best: ${st.hi}`, CW / 2, CH / 2 + 14);
        }
        raf = requestAnimationFrame(loop);
        return;
      }

      if (st.dead) {
        if (st.score > st.hi) {
          st.hi = st.score;
        }
        drawPlayer();
        st.obs.forEach((o) => {
          drawCactus(o.x, o.w, o.h);
        });
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, 0, CW, CH);
        const titleColor =
          st.deathResult === 'leaderboard'
            ? '#fbbf24'
            : st.deathResult === 'best'
              ? '#34d399'
              : '#ef4444';
        const titleText =
          st.deathResult === 'leaderboard'
            ? 'LEADERBOARD!'
            : st.deathResult === 'best'
              ? 'NEW BEST!'
              : 'GAME OVER';
        const subText =
          st.deathResult === 'leaderboard'
            ? 'you cracked the top 5'
            : st.deathResult === 'best'
              ? 'personal record'
              : '';
        ctx.fillStyle = titleColor;
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(titleText, CW / 2, CH / 2 - 26);
        if (subText) {
          ctx.fillStyle = titleColor;
          ctx.globalAlpha = 0.75;
          ctx.font = '11px monospace';
          ctx.fillText(subText, CW / 2, CH / 2 - 8);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '14px monospace';
        ctx.fillText(
          `Score: ${st.score}   Best: ${st.hi}`,
          CW / 2,
          subText ? CH / 2 + 10 : CH / 2 + 4,
        );
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px monospace';
        ctx.fillText(
          'SPACE / CLICK to retry  ·  ESC to exit',
          CW / 2,
          subText ? CH / 2 + 30 : CH / 2 + 28,
        );
        raf = requestAnimationFrame(loop);
        return;
      }

      if (!st.grounded) {
        st.vy += GRAVITY;
        st.y -= st.vy;
        if (st.y <= 0) {
          st.y = 0;
          st.vy = 0;
          st.grounded = true;
        }
      }
      st.score++;
      st.speed = initSpeed + st.score / (difficulty === 'faster' ? 120 : 200);
      st.spawnIn--;
      if (st.spawnIn <= 0) {
        const h = 36 + Math.random() * 36;
        const w = 18 + Math.random() * 14;
        st.obs.push({ x: CW + 10, w, h });
        st.spawnIn = Math.max(52, 115 - Math.floor(st.score / 150) * 8) + Math.random() * 60;
      }
      st.obs = st.obs.map((o) => ({ ...o, x: o.x - st.speed })).filter((o) => o.x > -60);

      const hx = PX + Math.round(FW * 0.3);
      const hw = Math.round(FW * 0.4);
      const hh = Math.round(FH * 0.45);
      const hy = GROUND - hh - st.y;
      for (const o of st.obs) {
        const ox = o.x + Math.round(o.w * 0.15);
        const ow = Math.round(o.w * 0.7);
        if (hx < ox + ow && hx + hw > ox && hy < GROUND && hy + hh > GROUND - o.h) {
          st.dead = true;
          const entries = leaderboardRef.current;
          const lowestScore = entries.at(-1)?.score ?? 0;
          const isNewBest = st.score > 0 && st.score > st.prevHi;
          const wouldQualify = entries.length < 5 || st.score > lowestScore;
          const onBoard = isNewBest && wouldQualify;
          st.deathResult = onBoard ? 'leaderboard' : isNewBest ? 'best' : 'lose';
          if (!scoreWrittenRef.current && agent && viewerDid) {
            scoreWrittenRef.current = true;
            onScore?.(st.score, difficulty);
            void writeRunnerStats(agent, viewerDid, st.score, system);
            void authFetch('/api/games/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ system, score: st.score }),
            });
          }
          break;
        }
      }

      st.tick++;
      if (st.tick >= 7) {
        st.frame = (st.frame + 1) % COLS;
        st.tick = 0;
      }

      drawPlayer();
      st.obs.forEach((o) => {
        drawCactus(o.x, o.w, o.h);
      });
      ctx.fillStyle = '#475569';
      ctx.font = '13px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`HI ${st.hi}  ${st.score}`, CW - 10, 22);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('click', tryJump);
    };
  }, [sprite, pds, did, onClose, onScore, agent, viewerDid, difficulty]);

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
      </div>
      <div className={styles.hint}>↑ / SPACE jump · double jump · ESC exit</div>
    </div>
  );
}
