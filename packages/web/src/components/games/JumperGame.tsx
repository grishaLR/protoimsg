import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { Agent } from '@atproto/api';
import type { Difficulty } from './GamesPanel';
import { useAuth } from '../../hooks/useAuth';
import { useActorSprite } from '../../hooks/useActorSprite';
import { blobUrl } from '../../lib/record-blobs';
import { authFetch } from '../../lib/api';
import { API_URL } from '../../lib/config';
import styles from './JumperGame.module.css';

const CW = 352;
const CH = 520;
const PLAT_H = 10;
const GRAVITY = 0.25;
const BOUNCE_V = -10.5;
const WALK_SPEED = 3.5;

type PlatType = 'solid' | 'crumble' | 'moving';

interface Plat {
  x: number;
  y: number;
  w: number;
  type: PlatType;
  dx: number;
  crumbleTimer: number;
  hasSpring: boolean;
}

interface BlackHole {
  x: number;
  y: number;
  angle: number;
}

interface Alien {
  x: number;
  y: number;
  dx: number;
  baseY: number;
  phase: number;
  amplitude: number;
  dyingTimer: number; // 0 = alive, >0 = death animation countdown
}

function makePlat(x: number, y: number, w: number, type: PlatType, hasSpring = false): Plat {
  return {
    x,
    y,
    w,
    type,
    hasSpring,
    dx: type === 'moving' ? (Math.random() > 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.9) : 0,
    crumbleTimer: -1,
  };
}

// Peak jump height = BOUNCE_V² / (2 * GRAVITY) ≈ 220px. Never gap more than this.
const MAX_GAP = 170;
const SPRING_V = BOUNCE_V * 2;
const _JETPACK_V = BOUNCE_V * 4;
const JETPACK_DURATION = 210;
const BH_RADIUS = 20; // event horizon — instant death
const BH_PULL_RADIUS = 100; // gravitational influence range // ~7 seconds at 60fps

function generatePlatforms(topY: number, bottomY: number, scrolled: number): Plat[] {
  const plats: Plat[] = [];
  const difficulty = Math.min(2, scrolled / 2000);
  let y = bottomY;
  let prevType: PlatType = 'solid';
  while (y > topY) {
    const w = Math.max(30, 68 - difficulty * 18 + Math.random() * 14);
    const x = 8 + Math.random() * (CW - w - 16);
    const r = Math.random();
    let type: PlatType = 'solid';
    // Only allow specials after a solid — prevents back-to-back unlandable platforms
    if (prevType === 'solid') {
      if (difficulty > 0.4 && r > 0.82) type = 'crumble';
      else if (difficulty > 0.7 && r > 0.74) type = 'moving';
    }
    // Springs appear only on solid platforms, more common early to reward exploration
    const hasSpring = type === 'solid' && Math.random() < 0.07;
    plats.push(makePlat(x, y, w, type, hasSpring));
    prevType = type;
    const gap = Math.min(MAX_GAP, 95 + difficulty * 55 + Math.random() * 25);
    y -= gap;
  }
  return plats;
}

async function writeJumperStats(agent: Agent, viewerDid: string, score: number, system: string) {
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
    const prev = existingGame?.[difficulty] as
      | { best?: number; tries?: number; worst?: number }
      | undefined;
    const now = new Date().toISOString();
    const updatedDifficulty = {
      best: Math.max(score, prev?.best ?? 0),
      tries: (prev?.tries ?? 0) + 1,
      worst: prev ? Math.min(score, prev.worst ?? score) : score,
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
    /* silently fail */
  }
}

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
  const imgRef = useRef<HTMLImageElement | null>(null);
  const jetpackImgRef = useRef<HTMLImageElement | null>(null);
  const alienImgRef = useRef<HTMLImageElement | null>(null);
  const springImgRef = useRef<HTMLImageElement | null>(null);
  const sfxJetpackRef = useRef<HTMLAudioElement | null>(null);
  const sfxAlienRef = useRef<HTMLAudioElement | null>(null);
  const sfxAlienProximityRef = useRef<HTMLAudioElement | null>(null);
  const sfxBlackHoleRef = useRef<HTMLAudioElement | null>(null);
  const sfxLoseRef = useRef<HTMLAudioElement | null>(null);
  const sfxWinRef = useRef<HTMLAudioElement | null>(null);
  const sfxAchievementRef = useRef<HTMLAudioElement | null>(null);
  const sfxAmbienceRef = useRef<HTMLAudioElement | null>(null);
  const sfxBoingRef = useRef<HTMLAudioElement | null>(null);
  const sfxLandRef = useRef<HTMLAudioElement | null>(null);
  const sfxEnemyDeathRef = useRef<HTMLAudioElement | null>(null);
  const sfxStartRef = useRef<HTMLAudioElement | null>(null);
  const [sfxMuted, setSfxMuted] = useState(
    () => localStorage.getItem('protoimsg:sfx-muted') === 'true',
  );
  const leaderboardRef = useRef<{ did: string; score: number }[]>([]);
  const scoreWrittenRef = useRef(false);

  useEffect(() => {
    if (!sprite?.spriteSheet.ref.$link || !pds || !did) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = blobUrl(pds, did, sprite.spriteSheet.ref.$link);
    img.onload = () => {
      imgRef.current = img;
    };
  }, [sprite, pds, did]);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/WarpDrive_01.mp3');
    audio.preload = 'auto';
    sfxJetpackRef.current = audio;
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Robot_Talk_02.mp3');
    audio.preload = 'auto';
    sfxAlienRef.current = audio;
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/SpaceShip_Engine_Small_Loop_00.mp3');
    audio.loop = true;
    audio.volume = 0;
    sfxAlienProximityRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Ambience_BlackHole_00.mp3');
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = 0;
    sfxBlackHoleRef.current = audio;
    return () => {
      audio.pause();
    };
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Jingle_Lose_00.mp3');
    audio.preload = 'auto';
    sfxLoseRef.current = audio;
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Jingle_Win_00.mp3');
    audio.preload = 'auto';
    sfxWinRef.current = audio;
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Jingle_Achievement_00.mp3');
    audio.preload = 'auto';
    sfxAchievementRef.current = audio;
  }, []);

  useEffect(() => {
    const audio = new Audio('/assets/games/sfx/Ambience_Space_00.mp3');
    audio.loop = true;
    audio.volume = 0.35;
    sfxAmbienceRef.current = audio;
    const p = audio.play().catch(() => {});
    return () => {
      void p.then(() => {
        audio.pause();
      });
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    const boing = new Audio('/assets/games/sfx/boing.mp3');
    boing.preload = 'auto';
    sfxBoingRef.current = boing;
  }, []);

  useEffect(() => {
    const land = new Audio('/assets/games/sfx/SoundBlowDull.mp3');
    land.preload = 'auto';
    sfxLandRef.current = land;
  }, []);

  useEffect(() => {
    const enemyDeath = new Audio('/assets/games/sfx/SoundEnemyDeath.mp3');
    enemyDeath.preload = 'auto';
    sfxEnemyDeathRef.current = enemyDeath;
  }, []);

  useEffect(() => {
    const start = new Audio('/assets/games/sfx/SoundStartLevel.mp3');
    start.preload = 'auto';
    sfxStartRef.current = start;
  }, []);

  useEffect(() => {
    localStorage.setItem('protoimsg:sfx-muted', String(sfxMuted));
    const allRefs = [
      sfxJetpackRef,
      sfxAlienRef,
      sfxAlienProximityRef,
      sfxBlackHoleRef,
      sfxLoseRef,
      sfxWinRef,
      sfxAchievementRef,
      sfxBoingRef,
      sfxLandRef,
      sfxEnemyDeathRef,
      sfxStartRef,
      sfxAmbienceRef,
    ];
    for (const r of allRefs) {
      if (r.current) r.current.muted = sfxMuted;
    }
    if (sfxMuted && sfxAmbienceRef.current) sfxAmbienceRef.current.pause();
    if (!sfxMuted && sfxAmbienceRef.current) void sfxAmbienceRef.current.play();
  }, [sfxMuted]);

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
        : Promise.resolve({ entries: [] }),
    ])
      .then(([ownRes, fasterRes]) => {
        const own = ownRes.status === 'fulfilled' ? ownRes.value.entries : [];
        const fasterDids = new Set(
          (fasterRes.status === 'fulfilled' ? fasterRes.value.entries : []).map((e) => e.did),
        );
        leaderboardRef.current = own.filter((e) => !fasterDids.has(e.did));
      })
      .catch(() => {
        /* non-critical */
      });
  }, [difficulty]);

  useEffect(() => {
    const img = new Image();
    img.src = '/assets/games/kenney-alien-ufo/PNG/shipGreen_manned.png';
    img.onload = () => {
      alienImgRef.current = img;
    };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.src = '/assets/games/spring.png';
    img.onload = () => {
      springImgRef.current = img;
    };
  }, []);

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
          jetpackImgRef.current = img;
        };
      })
      .catch(() => {});
  }, [pds, did]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const system = `jumper_${difficulty}`;
    const initAlienAt = difficulty === 'faster' ? 1200 : 2000;
    const initBlackHoleAt = difficulty === 'faster' ? 5000 : 8000;

    // Per-difficulty physics — shadow module-level constants
    const GRAV = difficulty === 'faster' ? 0.38 : GRAVITY; // fall faster
    const BNCE = difficulty === 'faster' ? -13.5 : BOUNCE_V; // same peak height, faster arc
    const WALK = difficulty === 'faster' ? 5.0 : WALK_SPEED;
    const SPRNG = difficulty === 'faster' ? BNCE * 1.8 : SPRING_V;
    const JPACK = difficulty === 'faster' ? -5.0 : -3.5; // jetpack upthrust

    const SCALE = 1;
    const FW = Math.round((sprite?.frameWidth ?? 16) * SCALE);
    const FH = Math.round((sprite?.frameHeight ?? 16) * SCALE);
    const COLS = sprite?.columns ?? 3;

    const initPlats = (): Plat[] => {
      const plats: Plat[] = [];
      // Guaranteed solid platform at start
      plats.push(makePlat(CW / 2 - 32, CH - 44, 64, 'solid'));
      // Sparse initial platforms — let generatePlatforms fill the rest on first frame
      let y = CH - 44 - 100;
      while (y > CH * 0.1) {
        const w = 44 + Math.random() * 16;
        const x = 8 + Math.random() * (CW - w - 16);
        plats.push(makePlat(x, y, w, 'solid'));
        y -= 95 + Math.random() * 35;
      }
      return plats;
    };

    const st = {
      px: CW / 2,
      py: CH - 44 - FH,
      pvx: 0,
      pvy: BNCE,
      plats: initPlats(),
      aliens: [] as Alien[],
      nextAlienAt: initAlienAt,
      blackHoles: [] as BlackHole[],
      nextBlackHoleAt: initBlackHoleAt,
      jetpackPickup: null as { x: number; y: number } | null,
      nextJetpackAt: 5000,
      jetpackFrames: 0,
      scrolled: 0,
      score: 0,
      dead: false,
      deadFrames: 0,
      deathCause: 'fall' as 'fall' | 'alien' | 'blackhole',
      deathResult: 'lose' as 'leaderboard' | 'best' | 'lose',
      suckedIn: false,
      suckTimer: 0,
      suckBhX: 0,
      suckBhY: 0,
      deadDelay: 0,
      started: false,
      frame: 0,
      tick: 0,
      facing: 1 as 1 | -1,
      touchLeft: false,
      touchRight: false,
      hi: 0,
      prevHi: 0,
    };

    // Async-fetch existing best — ATProto when authenticated, localStorage in practice mode
    if (!practiceMode && agent && viewerDid) {
      agent.com.atproto.repo
        .getRecord({ repo: viewerDid, collection: 'actor.rpg.stats', rkey: 'self' })
        .then((res) => {
          const gd = (res.data.value as Record<string, unknown> | undefined)?.jumper as
            | Record<string, unknown>
            | undefined;
          const dd = gd?.[difficulty] as { best?: number } | undefined;
          st.hi = dd?.best ?? 0;
          st.prevHi = st.hi;
        })
        .catch(() => {});
    } else {
      const lsKey = `protoimsg:practice:jumper_${difficulty}:best`;
      st.hi = parseInt(localStorage.getItem(lsKey) ?? '0', 10);
      st.prevHi = st.hi;
    }

    const reset = () => {
      scoreWrittenRef.current = false;
      st.plats = initPlats();
      st.aliens = [];
      st.nextAlienAt = initAlienAt;
      st.blackHoles = [];
      st.nextBlackHoleAt = initBlackHoleAt;
      if (sfxBlackHoleRef.current) {
        sfxBlackHoleRef.current.volume = 0;
        sfxBlackHoleRef.current.pause();
      }
      if (sfxAlienProximityRef.current) {
        sfxAlienProximityRef.current.volume = 0;
        sfxAlienProximityRef.current.pause();
      }
      if (sfxLoseRef.current) {
        sfxLoseRef.current.pause();
        sfxLoseRef.current.currentTime = 0;
      }
      if (sfxWinRef.current) {
        sfxWinRef.current.pause();
        sfxWinRef.current.currentTime = 0;
      }
      if (sfxAchievementRef.current) {
        sfxAchievementRef.current.pause();
        sfxAchievementRef.current.currentTime = 0;
      }
      st.jetpackPickup = null;
      st.nextJetpackAt = 5000;
      st.jetpackFrames = 0;
      st.px = CW / 2;
      st.py = CH - 44 - FH;
      st.pvx = 0;
      st.pvy = BNCE;
      st.scrolled = 0;
      st.score = 0;
      st.dead = false;
      st.deadFrames = 0;
      st.deathCause = 'fall';
      st.deathResult = 'lose';
      st.suckedIn = false;
      st.suckTimer = 0;
      st.deadDelay = 0;
      st.prevHi = st.hi;
      st.started = false;
      st.frame = 0;
      st.tick = 0;
      st.facing = 1;
    };

    const playDeathJingle = () => {
      const entries = leaderboardRef.current;
      const lowestScore = entries.at(-1)?.score ?? 0;
      const isNewBest = st.score > 0 && st.score > st.prevHi;
      const canPost = !practiceMode && !!(agent && viewerDid);
      const wouldQualify = entries.length < 5 || st.score > lowestScore;
      const onBoard = canPost && isNewBest && wouldQualify;
      st.deathResult = onBoard ? 'leaderboard' : isNewBest ? 'best' : 'lose';
      if (onBoard && sfxWinRef.current) {
        sfxWinRef.current.currentTime = 0;
        void sfxWinRef.current.play();
      } else if (isNewBest && sfxAchievementRef.current) {
        sfxAchievementRef.current.currentTime = 0;
        void sfxAchievementRef.current.play();
      } else if (sfxLoseRef.current) {
        sfxLoseRef.current.currentTime = 0;
        void sfxLoseRef.current.play();
      }
    };

    // ── Stars (static pixel art background) ──────────────────────────────────
    const STARS: { x: number; y: number; size: number; brightness: number }[] = [];
    for (let i = 0; i < 60; i++) {
      STARS.push({
        x: Math.random() * CW,
        y: Math.random() * CH,
        size: Math.random() > 0.85 ? 2 : 1,
        brightness: 0.3 + Math.random() * 0.7,
      });
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    const keys = { left: false, right: false };

    const onKey = (e: KeyboardEvent) => {
      const down = e.type === 'keydown';
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keys.left = down;
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keys.right = down;
        e.preventDefault();
      }
      if (e.key === 'Escape') onClose();
      if (down && st.dead && st.deadFrames >= 30) reset();
      if (down && !st.started) {
        st.started = true;
        if (sfxStartRef.current) {
          sfxStartRef.current.currentTime = 0;
          void sfxStartRef.current.play();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const onTouch = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      st.touchLeft = false;
      st.touchRight = false;
      for (let i = 0; i < e.touches.length; i++) {
        const tx = (e.touches[i]?.clientX ?? 0) - rect.left;
        if (tx < CW / 2) st.touchLeft = true;
        else st.touchRight = true;
      }
      if (!st.started && e.touches.length > 0) {
        st.started = true;
        if (sfxStartRef.current) {
          sfxStartRef.current.currentTime = 0;
          void sfxStartRef.current.play();
        }
      }
      if (st.dead && st.deadFrames >= 30 && e.touches.length > 0) reset();
    };
    const onTouchEnd = () => {
      st.touchLeft = false;
      st.touchRight = false;
    };
    canvas.addEventListener('touchstart', onTouch, { passive: false });
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    // ── Draw helpers ──────────────────────────────────────────────────────────
    const drawBg = () => {
      ctx.fillStyle = '#06000f';
      ctx.fillRect(0, 0, CW, CH);
      for (const s of STARS) {
        ctx.globalAlpha = s.brightness;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
    };

    const drawPlat = (p: Plat) => {
      const { x, y, w } = p;
      const h = PLAT_H;
      // Regenerating: ghost platform — faint, flashes bright when nearly back
      if (p.crumbleTimer < -1) {
        const nearReturn = p.crumbleTimer > -35;
        ctx.globalAlpha = nearReturn && Math.floor(-p.crumbleTimer / 4) % 2 === 0 ? 0.65 : 0.18;
        ctx.fillStyle = '#f97316';
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        return;
      }
      let top: string;
      let mid: string;
      let bot: string;

      if (p.type === 'crumble') {
        const flash = p.crumbleTimer > 0 && Math.floor(p.crumbleTimer / 4) % 2 === 0;
        top = flash ? '#fbbf24' : '#f97316';
        mid = flash ? '#d97706' : '#c2410c';
        bot = '#7c2d12';
      } else if (p.type === 'moving') {
        top = '#67e8f9';
        mid = '#0891b2';
        bot = '#164e63';
      } else {
        top = '#4ade80';
        mid = '#16a34a';
        bot = '#14532d';
      }

      ctx.fillStyle = mid;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = top;
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = bot;
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillStyle = bot;
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x + w - 2, y, 2, 2);

      // Moving direction arrow
      if (p.type === 'moving') {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.5;
        const ax = p.dx > 0 ? x + w - 8 : x + 4;
        ctx.fillRect(ax, y + 3, 4, 4);
        ctx.globalAlpha = 1;
      }

      // Crumble cracks
      if (p.type === 'crumble' && p.crumbleTimer < 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + Math.floor(w * 0.3), y + 2, 1, 5);
        ctx.fillRect(x + Math.floor(w * 0.65), y + 1, 1, 4);
      }

      // Spring — sprite above platform surface (frame 0 of 4-frame sheet)
      if (p.hasSpring) {
        const sImg = springImgRef.current;
        const sw = 18,
          sh = 22;
        const sx = Math.floor(x + w / 2 - sw / 2);
        if (sImg) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // Source: first frame (276×324 of 1104×324 sheet)
          ctx.drawImage(sImg, 0, 0, 276, 324, sx, y - sh, sw, sh);
        } else {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(sx, y - sh, sw, sh);
        }
      }
    };

    const drawPlayer = (px: number, py: number, facing: 1 | -1) => {
      const img = imgRef.current;
      if (img && sprite) {
        ctx.imageSmoothingEnabled = false;
        // Flip for direction using canvas transform
        ctx.save();
        if (facing === -1) {
          ctx.translate(px + FW, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(
            img,
            st.frame * sprite.frameWidth,
            2 * sprite.frameHeight,
            sprite.frameWidth,
            sprite.frameHeight,
            0,
            py,
            FW,
            FH,
          );
        } else {
          ctx.drawImage(
            img,
            st.frame * sprite.frameWidth,
            2 * sprite.frameHeight,
            sprite.frameWidth,
            sprite.frameHeight,
            px,
            py,
            FW,
            FH,
          );
        }
        ctx.restore();
      } else {
        // Fallback pixel character
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect(px + 4, py + Math.round(FH * 0.45), FW - 8, Math.round(FH * 0.55));
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(px + 4, py, FW - 8, Math.round(FH * 0.45));
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(px + 6, py + 5, 3, 3);
        ctx.fillRect(px + FW - 10, py + 5, 3, 3);
      }
    };

    const ALIEN_W = 48;
    const ALIEN_H = 48;
    const drawAlien = (a: Alien) => {
      const ax = Math.round(a.x);
      const ay = Math.round(a.y);
      const img = alienImgRef.current;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      if (a.dyingTimer > 0) {
        const t = a.dyingTimer / 22;
        const squashH = Math.round(ALIEN_H * t * 0.5);
        ctx.globalAlpha = t;
        if (img) {
          ctx.drawImage(img, ax, ay + ALIEN_H - squashH, ALIEN_W, squashH);
        }
      } else if (img) {
        if (a.dx < 0) {
          ctx.translate(ax + ALIEN_W, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, ay, ALIEN_W, ALIEN_H);
        } else {
          ctx.drawImage(img, ax, ay, ALIEN_W, ALIEN_H);
        }
      } else {
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(ax + 2, ay + 5, 16, 10);
        ctx.fillRect(ax + 5, ay + 1, 10, 6);
      }
      ctx.restore();
    };

    const drawJetpackPickup = (x: number, y: number) => {
      const img = jetpackImgRef.current;
      // Pulsing glow
      const pulse = 0.25 + Math.sin(Date.now() / 250) * 0.15;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x - 4, y - 4, 36, 36);
      ctx.globalAlpha = 1;
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, 28, 28);
      } else {
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(x + 4, y + 2, 20, 24);
        ctx.fillStyle = '#f97316';
        ctx.fillRect(x + 8, y + 22, 4, 6);
        ctx.fillRect(x + 16, y + 22, 4, 6);
      }
    };

    const drawBlackHole = (bh: BlackHole) => {
      const { x, y } = bh;
      // Gravitational lensing glow
      const outerGrad = ctx.createRadialGradient(x, y, BH_RADIUS, x, y, BH_PULL_RADIUS * 0.7);
      outerGrad.addColorStop(0, 'rgba(139,92,246,0.35)');
      outerGrad.addColorStop(0.5, 'rgba(59,7,100,0.15)');
      outerGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.arc(x, y, BH_PULL_RADIUS * 0.7, 0, Math.PI * 2);
      ctx.fill();
      // Accretion disk (flattened, rotating)
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(bh.angle);
      ctx.scale(1, 0.28);
      ctx.beginPath();
      ctx.arc(0, 0, BH_RADIUS + 14, 0, Math.PI * 2);
      const diskGrad = ctx.createRadialGradient(0, 0, BH_RADIUS, 0, 0, BH_RADIUS + 14);
      diskGrad.addColorStop(0, '#f97316');
      diskGrad.addColorStop(0.4, '#c084fc');
      diskGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = diskGrad;
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.restore();
      // Event horizon
      const coreGrad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, BH_RADIUS);
      coreGrad.addColorStop(0, '#1e1b4b');
      coreGrad.addColorStop(1, '#000000');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(x, y, BH_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // Bright photon ring
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, BH_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const drawHud = () => {
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(CW - 80, 6, 76, 30);
      ctx.fillStyle = '#4ade80';
      ctx.fillText(`${st.score}`, CW - 8, 20);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText(`BEST ${st.hi}`, CW - 8, 32);
    };

    // ── Game loop ─────────────────────────────────────────────────────────────
    let raf = 0;
    let lastFrameTime = 0;
    const FRAME_MS = 1000 / 60;

    const loop = (now: number) => {
      if (now - lastFrameTime < FRAME_MS - 1) {
        raf = requestAnimationFrame(loop);
        return;
      }
      lastFrameTime = now;
      drawBg();

      if (!st.started) {
        // Draw platforms and player at start position
        for (const p of st.plats) drawPlat(p);
        drawPlayer(st.px - FW / 2, st.py, st.facing);
        ctx.fillStyle = 'rgba(6,0,15,0.7)';
        ctx.fillRect(0, CH / 2 - 56, CW, 80);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${difficulty.toUpperCase()} JUMPER`, CW / 2, CH / 2 - 28);
        ctx.fillStyle = '#64748b';
        ctx.font = '11px monospace';
        ctx.fillText('← → / tap sides to move', CW / 2, CH / 2 - 8);
        if (st.hi > 0) {
          ctx.fillStyle = '#4ade80';
          ctx.fillText(`BEST ${st.hi}`, CW / 2, CH / 2 + 12);
        }
        raf = requestAnimationFrame(loop);
        return;
      }

      if (st.suckedIn) {
        for (const p of st.plats) drawPlat(p);
        if (st.deathCause === 'blackhole') for (const bh of st.blackHoles) drawBlackHole(bh);
        if (st.deathCause === 'alien') for (const a of st.aliens) drawAlien(a);
        // Spin + shrink toward target center
        const t = 1 - st.suckTimer / 70; // 0→1 as animation plays
        const ease = t * t; // ease-in: slow start, fast finish
        const cx = st.px + (st.suckBhX - st.px) * ease;
        const cy = st.py + FH / 2 + (st.suckBhY - (st.py + FH / 2)) * ease;
        const scale = Math.max(0, 1 - ease);
        const angle = t * Math.PI * 8; // 4 full rotations
        ctx.save();
        ctx.translate(Math.round(cx), Math.round(cy));
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        const img = imgRef.current;
        if (img && sprite) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            img,
            st.frame * sprite.frameWidth,
            2 * sprite.frameHeight,
            sprite.frameWidth,
            sprite.frameHeight,
            -FW / 2,
            -FH / 2,
            FW,
            FH,
          );
        } else {
          ctx.fillStyle = '#7c3aed';
          ctx.fillRect(-FW / 2 + 4, Math.round(-FH * 0.05), FW - 8, Math.round(FH * 0.55));
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(-FW / 2 + 4, -FH / 2, FW - 8, Math.round(FH * 0.45));
        }
        ctx.restore();
        st.suckTimer--;
        if (st.suckTimer <= 0) {
          st.suckedIn = false;
          st.deadDelay = 50; // hold ~0.8s before showing death overlay
          if (st.deathCause === 'alien' && sfxAlienRef.current && !sfxAlienRef.current.paused) {
            sfxAlienRef.current.addEventListener('ended', playDeathJingle, { once: true });
          } else {
            playDeathJingle();
          }
        }
        raf = requestAnimationFrame(loop);
        return;
      }

      if (st.deadDelay > 0) {
        st.deadDelay--;
        if (st.deadDelay === 0) st.dead = true;
        for (const p of st.plats) drawPlat(p);
        if (st.deathCause === 'blackhole') for (const bh of st.blackHoles) drawBlackHole(bh);
        if (st.deathCause === 'alien') for (const a of st.aliens) drawAlien(a);
        raf = requestAnimationFrame(loop);
        return;
      }

      if (st.dead) {
        st.deadFrames++;
        for (const p of st.plats) drawPlat(p);
        ctx.fillStyle = 'rgba(6,0,15,0.78)';
        ctx.fillRect(0, 0, CW, CH);
        const deathColor =
          st.deathCause === 'blackhole'
            ? '#a78bfa'
            : st.deathCause === 'alien'
              ? '#34d399'
              : '#ef4444';
        const deathTitle =
          st.deathCause === 'blackhole'
            ? 'SPAGHETTIFIED'
            : st.deathCause === 'alien'
              ? 'ABDUCTED'
              : 'YOU FELL';
        const deathSub =
          st.deathCause === 'blackhole'
            ? 'consumed by the void'
            : st.deathCause === 'alien'
              ? 'taken by the aliens'
              : 'into the abyss';
        ctx.fillStyle = deathColor;
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(deathTitle, CW / 2, CH / 2 - 34);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(deathSub, CW / 2, CH / 2 - 16);
        if (st.deathResult !== 'lose') {
          const resultColor = st.deathResult === 'leaderboard' ? '#fbbf24' : '#34d399';
          const resultText = st.deathResult === 'leaderboard' ? 'LEADERBOARD!' : 'NEW BEST!';
          const resultSub =
            st.deathResult === 'leaderboard' ? 'you cracked the top 5' : 'personal record';
          ctx.fillStyle = resultColor;
          ctx.font = 'bold 15px monospace';
          ctx.fillText(resultText, CW / 2, CH / 2 + 4);
          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px monospace';
          ctx.fillText(resultSub, CW / 2, CH / 2 + 18);
        }
        const hasResult = st.deathResult !== 'lose';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '13px monospace';
        ctx.fillText(`SCORE  ${st.score}`, CW / 2, hasResult ? CH / 2 + 34 : CH / 2 + 8);
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`BEST   ${st.hi}`, CW / 2, hasResult ? CH / 2 + 50 : CH / 2 + 26);
        ctx.fillStyle = '#64748b';
        ctx.font = '11px monospace';
        ctx.fillText(
          'any key / tap to retry  ·  ESC exit',
          CW / 2,
          hasResult ? CH / 2 + 66 : CH / 2 + 48,
        );
        raf = requestAnimationFrame(loop);
        return;
      }

      // ── Physics ──────────────────────────────────────────────────────────
      const goLeft = keys.left || st.touchLeft;
      const goRight = keys.right || st.touchRight;

      if (goLeft) {
        st.pvx = -WALK;
        st.facing = -1;
      } else if (goRight) {
        st.pvx = WALK;
        st.facing = 1;
      } else {
        st.pvx *= 0.8;
      }

      st.px += st.pvx;
      // Wrap horizontally
      if (st.px < -FW / 2) st.px = CW + FW / 2;
      if (st.px > CW + FW / 2) st.px = -FW / 2;

      if (st.jetpackFrames > 0) {
        // Gravity suspended — constant upward thrust
        st.pvy = JPACK;
      } else {
        st.pvy += GRAV;
        if (st.pvy > 18) st.pvy = 18; // terminal velocity — prevents tunneling through alien hitboxes
      }
      st.py += st.pvy;

      // Player hitbox bottom
      const playerBottom = st.py + FH;
      const playerLeft = st.px - FW * 0.28;
      const playerRight = st.px + FW * 0.28;

      // Platform collisions (only when falling downward, jetpack bypasses platforms)
      if (st.pvy > 0 && st.jetpackFrames === 0) {
        for (const p of st.plats) {
          if (p.crumbleTimer > 0 || p.crumbleTimer < -1) continue;
          const prevBottom = playerBottom - st.pvy;
          const onX = playerRight > p.x && playerLeft < p.x + p.w;
          const crossTop = prevBottom <= p.y && playerBottom >= p.y;
          if (onX && crossTop) {
            if (p.type === 'crumble') {
              // bounce normally but start crumble — platform disappears on next land
              p.crumbleTimer = 40;
              st.pvy = BNCE;
              st.py = p.y - FH;
              if (sfxLandRef.current) {
                sfxLandRef.current.currentTime = 0;
                void sfxLandRef.current.play();
              }
            } else {
              const isSpring = p.hasSpring;
              const boost = p.hasSpring ? SPRNG : BNCE;
              st.pvy = boost;
              st.py = p.y - FH;
              if (isSpring && sfxBoingRef.current) {
                sfxBoingRef.current.currentTime = 0;
                void sfxBoingRef.current.play();
              } else if (!isSpring && sfxLandRef.current) {
                sfxLandRef.current.currentTime = 0;
                void sfxLandRef.current.play();
              }
            }
            break;
          }
        }
      }

      // Alien movement + collision
      const alienDiff = Math.min(2, st.scrolled / 2000);
      for (const a of st.aliens) {
        if (a.dyingTimer > 0) {
          a.dyingTimer--;
          if (a.dyingTimer === 0) a.dyingTimer = -1;
          continue;
        }
        if (a.dyingTimer === -1) continue;
        a.x += a.dx;
        a.phase += 0.04;
        a.y = a.baseY + Math.sin(a.phase) * a.amplitude;
        if (a.x < -20) a.dx = Math.abs(a.dx);
        if (a.x > CW + 4) a.dx = -Math.abs(a.dx);
      }
      // Spawn next alien when threshold crossed
      if (st.scrolled >= st.nextAlienAt && alienDiff > 0.3) {
        const fromLeft = Math.random() > 0.5;
        const spawnY = CH * 0.15 + Math.random() * CH * 0.55;
        st.aliens.push({
          x: fromLeft ? -16 : CW + 16,
          y: spawnY,
          baseY: spawnY,
          dx: (fromLeft ? 1 : -1) * (0.6 + alienDiff * 0.5 + Math.random() * 0.4),
          phase: Math.random() * Math.PI * 2,
          amplitude: 20 + Math.random() * 30,
          dyingTimer: 0,
        });
        // Interval shrinks with difficulty: 800px → 400px
        st.nextAlienAt += Math.max(800, 1600 - alienDiff * 400);
      }
      // Jetpack pickup — spawn, collect, expire
      if (st.jetpackFrames > 0) st.jetpackFrames--;
      if (st.scrolled >= st.nextJetpackAt && !st.jetpackPickup) {
        // Place on a solid platform above the screen
        const candidates = st.plats.filter(
          (p) => p.y < -20 && p.y > -CH * 2 && p.type === 'solid' && !p.hasSpring,
        );
        const host = candidates[Math.floor(Math.random() * candidates.length)];
        if (host) {
          st.jetpackPickup = { x: host.x + host.w / 2 - 14, y: host.y - 28 };
          st.nextJetpackAt += 6000 + Math.random() * 2000;
        }
        // If no candidate platform yet, keep checking each frame until one appears
      }
      if (st.jetpackPickup) {
        if (st.jetpackPickup.y > CH + 40) {
          st.jetpackPickup = null;
        } else {
          const jp = st.jetpackPickup;
          const overX = st.px + FW * 0.4 > jp.x && st.px - FW * 0.4 < jp.x + 28;
          const overY = st.py + FH > jp.y && st.py < jp.y + 28;
          if (overX && overY) {
            st.jetpackFrames = JETPACK_DURATION;
            st.jetpackPickup = null;
            if (sfxJetpackRef.current) {
              sfxJetpackRef.current.currentTime = 0;
              void sfxJetpackRef.current.play();
            }
          }
        }
      }

      st.aliens = st.aliens.filter(
        (a) => a.dyingTimer !== -1 && (a.dyingTimer > 0 || a.y < CH + 40),
      );
      // Black holes — spawn, animate, gravity, death
      if (st.scrolled >= st.nextBlackHoleAt) {
        st.blackHoles.push({
          x: 35 + Math.random() * (CW - 70),
          y: -CH * 0.5,
          angle: 0,
        });
        st.nextBlackHoleAt += 6000 + Math.random() * 4000;
      }
      let closestBhDist = Infinity;
      for (const bh of st.blackHoles) {
        bh.angle += 0.025;
        const bcx = bh.x,
          bcy = bh.y;
        const bdx = bcx - st.px,
          bdy = bcy - (st.py + FH / 2);
        const dist = Math.sqrt(bdx * bdx + bdy * bdy);
        if (dist < closestBhDist) closestBhDist = dist;
        if (dist < BH_RADIUS && !st.suckedIn) {
          st.suckedIn = true;
          st.suckTimer = 70;
          st.suckBhX = bcx;
          st.suckBhY = bcy;
          st.deathCause = 'blackhole';
          if (sfxBlackHoleRef.current) {
            sfxBlackHoleRef.current.volume = 0;
            sfxBlackHoleRef.current.pause();
          }
          if (!scoreWrittenRef.current) {
            scoreWrittenRef.current = true;
            onScore?.(st.score, difficulty);
            if (!practiceMode && agent && viewerDid) {
              void writeJumperStats(agent, viewerDid, st.score, system);
              void authFetch('/api/games/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system, score: st.score }),
              });
            } else {
              const lsKey = `protoimsg:practice:jumper_${difficulty}:best`;
              if (st.score > st.prevHi) localStorage.setItem(lsKey, String(st.score));
            }
          }
        } else if (dist < BH_PULL_RADIUS) {
          const pull = 1.2 * Math.pow(1 - dist / BH_PULL_RADIUS, 2);
          st.pvx += (bdx / dist) * pull;
          st.pvy += (bdy / dist) * pull;
        }
      }
      st.blackHoles = st.blackHoles.filter((bh) => bh.y < CH + 60);
      // Ambient black hole audio — fades in as it approaches from off-screen
      // Alien proximity audio
      const ALIEN_WARN_RADIUS = 340;
      if (sfxAlienProximityRef.current) {
        const alienAudio = sfxAlienProximityRef.current;
        let closestAlienDist = Infinity;
        for (const a of st.aliens) {
          if (a.dyingTimer !== 0) continue;
          const adx = a.x + 24 - st.px;
          const ady = a.y + 24 - (st.py + FH / 2);
          const d = Math.sqrt(adx * adx + ady * ady);
          if (d < closestAlienDist) closestAlienDist = d;
        }
        if (closestAlienDist < ALIEN_WARN_RADIUS) {
          const vol = Math.max(0, Math.min(0.7, 1 - closestAlienDist / ALIEN_WARN_RADIUS));
          if (alienAudio.paused) void alienAudio.play();
          alienAudio.volume = vol;
        } else {
          alienAudio.volume = 0;
        }
      }

      const BH_WARN_RADIUS = 380;
      if (sfxBlackHoleRef.current) {
        const bhAudio = sfxBlackHoleRef.current;
        if (closestBhDist < BH_WARN_RADIUS) {
          const vol = Math.max(
            0,
            Math.min(1, 1 - (closestBhDist - BH_RADIUS) / (BH_WARN_RADIUS - BH_RADIUS)),
          );
          if (bhAudio.paused) void bhAudio.play();
          bhAudio.volume = vol;
        } else {
          bhAudio.volume = 0;
        }
      }

      // Stomp = falling and feet cross alien top → kill alien. Side/bottom = player dies.
      for (const a of st.aliens) {
        if (a.dyingTimer !== 0) continue;
        const overlapX = st.px + FW * 0.28 > a.x + 6 && st.px - FW * 0.28 < a.x + 42;
        if (!overlapX) continue;
        const overlapY = st.py + FH > a.y + 8 && st.py < a.y + 44;
        if (!overlapY) continue;
        // Stomp: player falling AND feet land within 20px of alien's top hitbox edge
        const playerBottom = st.py + FH;
        const alienHitTop = a.y + 8;
        if (st.pvy > 0 && playerBottom - alienHitTop < 20) {
          a.dyingTimer = 22;
          st.pvy = BNCE;
          st.py = a.y + 8 - FH;
          if (sfxEnemyDeathRef.current) {
            sfxEnemyDeathRef.current.currentTime = 0;
            void sfxEnemyDeathRef.current.play();
          }
        } else {
          st.suckedIn = true;
          st.suckTimer = 70;
          st.suckBhX = a.x + 24;
          st.suckBhY = a.y + 24;
          st.deathCause = 'alien';
          if (!scoreWrittenRef.current) {
            scoreWrittenRef.current = true;
            onScore?.(st.score, difficulty);
            if (!practiceMode && agent && viewerDid) {
              void writeJumperStats(agent, viewerDid, st.score, system);
              void authFetch('/api/games/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system, score: st.score }),
              });
            } else {
              const lsKey = `protoimsg:practice:jumper_${difficulty}:best`;
              if (st.score > st.prevHi) localStorage.setItem(lsKey, String(st.score));
            }
          }
          // Silence everything except the robot talk
          [
            sfxAlienProximityRef,
            sfxBlackHoleRef,
            sfxAmbienceRef,
            sfxLandRef,
            sfxBoingRef,
            sfxEnemyDeathRef,
            sfxStartRef,
            sfxJetpackRef,
          ].forEach((r) => {
            if (r.current) {
              r.current.pause();
              r.current.currentTime = 0;
            }
          });
          if (sfxAlienRef.current) {
            sfxAlienRef.current.currentTime = 0;
            void sfxAlienRef.current.play();
          }
          break;
        }
      }

      // Update crumbling/regenerating platforms
      for (const p of st.plats) {
        if (p.crumbleTimer > 0) {
          p.crumbleTimer--;
          if (p.crumbleTimer === 0) p.crumbleTimer = -200; // enter regen phase
        } else if (p.crumbleTimer < -1) {
          p.crumbleTimer++; // count toward -1 (solid)
        }
      }

      // Move moving platforms
      for (const p of st.plats) {
        if (p.type !== 'moving') continue;
        p.x += p.dx;
        if (p.x < 0 || p.x + p.w > CW) p.dx *= -1;
      }

      // Camera scroll — keep player in upper 40% of screen
      const targetY = CH * 0.4;
      if (st.py < targetY) {
        const scroll = targetY - st.py;
        st.py = targetY;
        for (const p of st.plats) p.y += scroll;
        for (const a of st.aliens) {
          a.y += scroll;
          a.baseY += scroll;
        }
        for (const bh of st.blackHoles) bh.y += scroll;
        if (st.jetpackPickup) st.jetpackPickup.y += scroll;
        st.scrolled += scroll;
        st.score = Math.floor(st.scrolled / 8);
        if (st.score > st.hi) {
          st.hi = st.score;
        }
      }

      // Cull platforms below screen
      st.plats = st.plats.filter((p) => p.y < CH + 20);
      // Only generate when platforms are within one screen of the top edge.
      // Generate 3000px ahead so this fires at most once per ~12 seconds of play.
      const topmost = st.plats.length ? Math.min(...st.plats.map((p) => p.y)) : CH;
      if (topmost > -CH) {
        st.plats.push(...generatePlatforms(-3000, topmost - 130, st.scrolled));
      }

      // Death — fell off bottom
      if (st.py > CH + 20) {
        st.dead = true;
        st.deathCause = 'fall';
        playDeathJingle();
        if (!scoreWrittenRef.current) {
          scoreWrittenRef.current = true;
          onScore?.(st.score, difficulty);
          if (!practiceMode && agent && viewerDid) {
            void writeJumperStats(agent, viewerDid, st.score, system);
            void authFetch('/api/games/score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ system, score: st.score }),
            });
          } else {
            const lsKey = `protoimsg:practice:jumper_${difficulty}:best`;
            if (st.score > st.prevHi) localStorage.setItem(lsKey, String(st.score));
          }
        }
      }

      // ── Render ────────────────────────────────────────────────────────────
      for (const bh of st.blackHoles) drawBlackHole(bh);
      for (const p of st.plats) drawPlat(p);
      if (st.jetpackPickup) drawJetpackPickup(st.jetpackPickup.x, st.jetpackPickup.y);
      for (const a of st.aliens) drawAlien(a);
      drawPlayer(st.px - FW / 2, st.py, st.facing);
      // Jetpack flame + timer bar when active
      if (st.jetpackFrames > 0) {
        const flicker = Math.random() > 0.4;
        ctx.fillStyle = flicker ? '#f97316' : '#fbbf24';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(
          Math.round(st.px - FW * 0.2),
          Math.round(st.py + FH),
          Math.round(FW * 0.4),
          5 + Math.floor(Math.random() * 4),
        );
        ctx.globalAlpha = 1;
        // Timer bar at bottom
        ctx.fillStyle = '#f97316';
        ctx.fillRect(4, CH - 8, Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)), 4);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(
          4,
          CH - 8,
          Math.floor((st.jetpackFrames / JETPACK_DURATION) * (CW - 8)) - 2,
          2,
        );
      }

      // Sprite animation
      st.tick++;
      if (st.tick >= 8) {
        st.frame = (st.frame + 1) % COLS;
        st.tick = 0;
      }

      drawHud();

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      canvas.removeEventListener('touchstart', onTouch);
      canvas.removeEventListener('touchmove', onTouch);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [sprite, pds, did, onClose, onScore, agent, viewerDid, difficulty]);

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
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        className={styles.canvas}
        style={{ width: CW, height: CH }}
      />
      <div className={styles.hint}>← → / A D · tap left or right side on mobile</div>
    </div>
  );
}
