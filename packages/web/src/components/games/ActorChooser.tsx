import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_MASTER_DID, RPG_ACTOR_API_URL } from '../../lib/config';
import { resolveDisplayNameForDid, resolvePdsForDid } from '../../lib/resolve-pds';
import styles from './ActorChooser.module.css';

const LS_KEY = 'protoimsg:practice:selectedActorDid';
const FW = 48;
const FH = 48;
const COLS = 3;
const MAX_RETRIES = 10;

const DIR_FORWARD = 0;
const DIR_BACK = 3;
const DIR_LEFT = 1;
const DIR_RIGHT = 2;

interface Slot {
  did: string;
  img: HTMLImageElement | null;
  status: 'loading' | 'ready' | 'failed';
}

const FALLBACK_SLOT: Slot = { did: GAME_MASTER_DID, img: null, status: 'loading' };

interface ActorChooserProps {
  locked: boolean;
  onSelect: (did: string, pds: string) => void;
}

function spriteNormalizedUrl(did: string): string {
  return `${RPG_ACTOR_API_URL}/api/sprite/normalized?did=${encodeURIComponent(did)}`;
}

function fetchNormalizedSprite(did: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = spriteNormalizedUrl(did);
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`failed to load sprite for ${did}`));
    };
  });
}

function parseDids(data: unknown): string[] {
  if (Array.isArray(data)) {
    return (data as unknown[])
      .map((d) =>
        typeof d === 'string'
          ? d
          : typeof d === 'object' && d !== null && 'did' in d
            ? String((d as { did: unknown }).did)
            : '',
      )
      .filter(Boolean);
  }
  if (typeof data === 'object' && data !== null && 'actors' in data) {
    const actors = (data as { actors: unknown }).actors;
    if (Array.isArray(actors)) {
      // Skip actors with no sprite record — they render as blank characters.
      return actors
        .filter(
          (a): a is { did: unknown } =>
            typeof a === 'object' &&
            a !== null &&
            (a as { hasSprite?: unknown }).hasSprite !== false,
        )
        .map((a) => (typeof a.did === 'string' ? a.did : ''))
        .filter(Boolean);
    }
    return parseDids(actors);
  }
  return [];
}

// ── Animated preview ──────────────────────────────────────────────────────

function SpritePreview({ img, name }: { img: HTMLImageElement | null; name: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [direction, setDirection] = useState(DIR_FORWARD);
  const [walking, setWalking] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = (frame: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!img) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, frame * FW, direction * FH, FW, FH, 0, 0, canvas.width, canvas.height);
    };

    if (!walking || !img) {
      draw(0);
      return;
    }

    let frame = 0;
    draw(frame);
    const id = setInterval(() => {
      frame = (frame + 1) % COLS;
      draw(frame);
    }, 140);
    return () => {
      clearInterval(id);
    };
  }, [img, direction, walking]);

  function face(dir: number) {
    setDirection(dir);
    setWalking(true);
  }

  return (
    <div className={styles.preview}>
      <div className={styles.previewChar}>
        <canvas ref={canvasRef} width={96} height={96} className={styles.previewCanvas} />
        <div className={styles.handle}>{name || ' '}</div>
      </div>
      <div className={styles.dpad}>
        <div className={styles.dpadRow}>
          <button
            className={`${styles.dpadBtn} ${direction === DIR_BACK && walking ? styles.dpadActive : ''}`}
            onClick={() => {
              face(DIR_BACK);
            }}
            type="button"
            title="backward"
          >
            ▲
          </button>
        </div>
        <div className={styles.dpadRow}>
          <button
            className={`${styles.dpadBtn} ${direction === DIR_LEFT && walking ? styles.dpadActive : ''}`}
            onClick={() => {
              face(DIR_LEFT);
            }}
            type="button"
            title="left"
          >
            ◀
          </button>
          <button
            className={`${styles.dpadBtn} ${!walking ? styles.dpadActive : ''}`}
            onClick={() => {
              setWalking((w) => !w);
            }}
            type="button"
            title="freeze"
          >
            ■
          </button>
          <button
            className={`${styles.dpadBtn} ${direction === DIR_RIGHT && walking ? styles.dpadActive : ''}`}
            onClick={() => {
              face(DIR_RIGHT);
            }}
            type="button"
            title="right"
          >
            ▶
          </button>
        </div>
        <div className={styles.dpadRow}>
          <button
            className={`${styles.dpadBtn} ${direction === DIR_FORWARD && walking ? styles.dpadActive : ''}`}
            onClick={() => {
              face(DIR_FORWARD);
            }}
            type="button"
            title="forward"
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Carousel slot canvas ──────────────────────────────────────────────────

function SlotCanvas({ slot, size }: { slot: Slot; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (!slot.img) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(slot.img, 0, DIR_FORWARD * FH, FW, FH, 0, 0, size, size);
  }, [slot.img, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={styles.slotCanvas} />;
}

// ── Main component ────────────────────────────────────────────────────────

export function ActorChooser({ locked, onSelect }: ActorChooserProps) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [slots, setSlots] = useState<Slot[]>(() =>
    Array.from({ length: 5 }, () => ({
      did: GAME_MASTER_DID,
      img: null,
      status: 'loading' as const,
    })),
  );
  const [ready, setReady] = useState(false);
  const [centerName, setCenterName] = useState<string | null>(null);

  const poolRef = useRef<string[]>([]);
  const rightIdxRef = useRef(5);
  const leftIdxRef = useRef(-1);
  const failedRef = useRef<Set<string>>(new Set());
  const fallbackImgRef = useRef<HTMLImageElement | null>(null);
  const slotsRef = useRef<Slot[]>(slots);
  slotsRef.current = slots;

  const pickNext = useCallback((direction: 'left' | 'right'): string => {
    const pool = poolRef.current;
    if (!pool.length) return GAME_MASTER_DID;
    const inUse = new Set(slotsRef.current.map((s) => s.did));
    for (let tries = 0; tries < MAX_RETRIES; tries++) {
      let did: string;
      if (direction === 'right') {
        did = pool[rightIdxRef.current % pool.length] ?? GAME_MASTER_DID;
        rightIdxRef.current++;
      } else {
        const idx = ((leftIdxRef.current % pool.length) + pool.length) % pool.length;
        leftIdxRef.current = idx - 1;
        did = pool[idx] ?? GAME_MASTER_DID;
      }
      if (did && !failedRef.current.has(did) && !inUse.has(did)) return did;
    }
    return GAME_MASTER_DID;
  }, []);

  const fetchSlot = useCallback(
    async (
      did: string,
      slotIdx: number,
      dir: 'left' | 'right' | 'init',
      retries = 0,
    ): Promise<void> => {
      try {
        const img = await fetchNormalizedSprite(did);
        setSlots((prev) => {
          if (prev[slotIdx]?.did !== did) return prev;
          const next = [...prev];
          next[slotIdx] = { did, img, status: 'ready' };
          return next;
        });
      } catch {
        failedRef.current.add(did);
        const nextDir = dir === 'init' ? 'right' : dir;
        if (retries >= MAX_RETRIES) {
          const fallback = fallbackImgRef.current;
          setSlots((prev) => {
            if (prev[slotIdx]?.did !== did) return prev;
            const next = [...prev];
            next[slotIdx] = {
              did: GAME_MASTER_DID,
              img: fallback,
              status: fallback ? 'ready' : 'failed',
            };
            return next;
          });
          return;
        }
        const nextDid = pickNext(nextDir);
        setSlots((prev) => {
          if (prev[slotIdx]?.did !== did) return prev;
          const next = [...prev];
          next[slotIdx] = { did: nextDid, img: null, status: 'loading' };
          return next;
        });
        void fetchSlot(nextDid, slotIdx, nextDir, retries + 1);
      }
    },
    [pickNext],
  );

  useEffect(() => {
    async function init() {
      const fallbackImg = await fetchNormalizedSprite(GAME_MASTER_DID).catch(() => null);
      fallbackImgRef.current = fallbackImg;

      let pool: string[] = [];
      try {
        const res = await fetch(`${RPG_ACTOR_API_URL}/api/actors`);
        pool = parseDids((await res.json()) as unknown);
      } catch {
        /* use empty pool, will fill with GAME_MASTER_DID */
      }

      if (!pool.includes(GAME_MASTER_DID)) pool.unshift(GAME_MASTER_DID);

      const saved = localStorage.getItem(LS_KEY);
      const preferred = saved && pool.includes(saved) ? saved : GAME_MASTER_DID;

      // Shuffle, place preferred at index 2
      const rest = pool.filter((d) => d !== preferred);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = rest[i];
        const b = rest[j];
        if (a === undefined || b === undefined) continue;
        rest[i] = b;
        rest[j] = a;
      }
      const orderedPool = [...rest.slice(0, 2), preferred, ...rest.slice(2)];
      poolRef.current = orderedPool;
      rightIdxRef.current = 5;
      leftIdxRef.current = orderedPool.length - 1;

      const initDids = Array.from({ length: 5 }, (_, i) => orderedPool[i] ?? GAME_MASTER_DID);
      setSlots(initDids.map((did) => ({ did, img: null, status: 'loading' as const })));
      setReady(true);

      await Promise.all(initDids.map((did, i) => fetchSlot(did, i, 'init')));
    }
    void init();
  }, []); // fetchSlot is stable via useCallback with no changing deps

  // slots always has 5 elements (initialized with 5, navigation maintains 5)
  const centerSlot = slots[2] ?? FALLBACK_SLOT;
  const centerDid = centerSlot.did;
  const centerStatus = centerSlot.status;
  const centerImg = centerSlot.img;

  useEffect(() => {
    if (!ready || centerStatus !== 'ready') return;
    localStorage.setItem(LS_KEY, centerDid);
    resolvePdsForDid(centerDid)
      .then((pds) => {
        onSelectRef.current(centerDid, pds ?? '');
      })
      .catch(() => {
        onSelectRef.current(centerDid, '');
      });
  }, [centerDid, centerStatus, ready]);

  useEffect(() => {
    if (!ready || centerStatus !== 'ready') return;
    let cancelled = false;
    setCenterName(null);
    resolveDisplayNameForDid(centerDid)
      .then((name) => {
        if (!cancelled) setCenterName(name);
      })
      .catch(() => {
        if (!cancelled) setCenterName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [centerDid, centerStatus, ready]);

  function goRight() {
    if (!ready) return;
    const newDid = pickNext('right');
    const newSlot: Slot = { did: newDid, img: null, status: 'loading' };
    setSlots((prev) => [
      prev[1] ?? FALLBACK_SLOT,
      prev[2] ?? FALLBACK_SLOT,
      prev[3] ?? FALLBACK_SLOT,
      prev[4] ?? FALLBACK_SLOT,
      newSlot,
    ]);
    void fetchSlot(newDid, 4, 'right');
  }

  function goLeft() {
    if (!ready) return;
    const newDid = pickNext('left');
    const newSlot: Slot = { did: newDid, img: null, status: 'loading' };
    setSlots((prev) => [
      newSlot,
      prev[0] ?? FALLBACK_SLOT,
      prev[1] ?? FALLBACK_SLOT,
      prev[2] ?? FALLBACK_SLOT,
      prev[3] ?? FALLBACK_SLOT,
    ]);
    void fetchSlot(newDid, 0, 'left');
  }

  return (
    <div className={`${styles.wrap} ${locked ? styles.locked : ''}`}>
      <div className={styles.title}>Choose Your Character</div>
      <div className={styles.divider} />
      <p className={styles.footnote}>
        Haven't made your character yet? Head to{' '}
        <a
          href="https://rpg.actor/generator"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footnoteLink}
        >
          rpg.actor/generator
        </a>{' '}
        to create one and you could appear here.
      </p>

      <SpritePreview img={centerImg} name={centerName} />

      <div className={styles.divider} />

      <div className={styles.carousel}>
        <button
          className={styles.carouselArrow}
          onClick={goLeft}
          type="button"
          aria-label="Previous character"
          disabled={!ready}
        >
          ◀
        </button>
        <div className={styles.carouselTrack}>
          <button
            className={`${styles.slotBtn} ${styles.slotSide}`}
            onClick={goLeft}
            type="button"
            aria-label="Select previous character"
          >
            <SlotCanvas slot={slots[1] ?? FALLBACK_SLOT} size={40} />
          </button>
          <div className={styles.slotCenter}>
            <SlotCanvas slot={centerSlot} size={52} />
          </div>
          <button
            className={`${styles.slotBtn} ${styles.slotSide}`}
            onClick={goRight}
            type="button"
            aria-label="Select next character"
          >
            <SlotCanvas slot={slots[3] ?? FALLBACK_SLOT} size={40} />
          </button>
        </div>
        <button
          className={styles.carouselArrow}
          onClick={goRight}
          type="button"
          aria-label="Next character"
          disabled={!ready}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
