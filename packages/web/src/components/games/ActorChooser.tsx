import { useEffect, useMemo, useRef, useState } from 'react';
import { RPG_ACTOR_API_URL, GAME_MASTER_DID } from '../../lib/config';
import styles from './ActorChooser.module.css';

const LS_KEY = 'protoimsg:practice:selectedActorDid';

// Sprite sheet row → direction (this sheet: south=0, north=1, west=2, east=3)
const DIR_FORWARD = 0; // south — facing viewer
const DIR_BACK = 3; // north — facing away
const DIR_LEFT = 1; // west
const DIR_RIGHT = 2; // east

interface FullActor {
  did: string;
  pds: string;
  handle: string;
  displayName?: string;
  sprite?: {
    frameWidth: number;
    frameHeight: number;
    columns: number;
    url: string;
  };
}

interface ActorChooserProps {
  locked: boolean;
  onSelect: (did: string, pds: string) => void;
}

// ── Animated preview ──────────────────────────────────────────────────────

function SpritePreview({ actor }: { actor: FullActor | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [direction, setDirection] = useState(DIR_FORWARD);
  const [walking, setWalking] = useState(true);

  useEffect(() => {
    if (!actor?.sprite) return;
    setImgReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = actor.sprite.url;
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
  }, [actor?.sprite?.url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !actor?.sprite) return;
    const { frameWidth, frameHeight, columns } = actor.sprite;
    const ctxOrNull = canvas.getContext('2d');
    if (!ctxOrNull) return;
    const ctx = ctxOrNull;

    function draw(frame: number) {
      const img = imgRef.current;
      if (!img || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        frame * frameWidth,
        direction * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }

    if (!walking || !imgReady) {
      if (imgReady) draw(0);
      return;
    }

    let frame = 0;
    draw(frame);
    const id = setInterval(() => {
      frame = (frame + 1) % columns;
      draw(frame);
    }, 140);
    return () => {
      clearInterval(id);
    };
  }, [actor?.sprite, direction, walking, imgReady]);

  function face(dir: number) {
    setDirection(dir);
    setWalking(true);
  }

  const name = actor?.displayName?.trim() || actor?.handle.split('.').at(0) || '';

  return (
    <div className={styles.preview}>
      <div className={styles.previewChar}>
        <canvas ref={canvasRef} width={96} height={96} className={styles.previewCanvas} />
        {name && <span className={styles.previewName}>{name}</span>}
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

// ── Grid card ─────────────────────────────────────────────────────────────

function SpriteCard({
  actor,
  selected,
  onSelect,
  dataDid,
}: {
  actor: FullActor;
  selected: boolean;
  onSelect: () => void;
  dataDid?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!actor.sprite) return;
    const { url, frameWidth, frameHeight } = actor.sprite;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        0,
        DIR_FORWARD * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };
  }, [actor.sprite]);

  const name = actor.displayName?.trim() || actor.handle.split('.')[0] || actor.handle;

  return (
    <button
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={onSelect}
      type="button"
      title={actor.displayName || actor.handle}
      data-did={dataDid}
    >
      <canvas ref={canvasRef} width={40} height={40} className={styles.cardCanvas} />
      <span className={styles.cardName}>{name}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function ActorChooser({ locked, onSelect }: ActorChooserProps) {
  const [actors, setActors] = useState<FullActor[]>([]);
  const [selectedDid, setSelectedDid] = useState<string>(GAME_MASTER_DID);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return actors
      .filter((a) => {
        const name = (a.displayName?.trim() || a.handle).toLowerCase();
        return name.includes(q) || a.handle.toLowerCase().includes(q);
      })
      .slice(0, 6);
  }, [actors, searchQuery]);

  useEffect(() => {
    fetch(`${RPG_ACTOR_API_URL}/api/actors/full`)
      .then((r) => r.json())
      .then((data: { actors: FullActor[] }) => {
        const withSprite = data.actors.filter((a) => !!a.sprite && !!a.pds);
        setActors(withSprite);

        const saved = localStorage.getItem(LS_KEY);
        const hasSaved = saved && withSprite.some((a) => a.did === saved);
        const target = hasSaved ? saved : GAME_MASTER_DID;
        const actor = withSprite.find((a) => a.did === target) ?? withSprite[0];
        if (actor) {
          setSelectedDid(actor.did);
          onSelect(actor.did, actor.pds);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, []);

  function select(actor: FullActor) {
    setSelectedDid(actor.did);
    localStorage.setItem(LS_KEY, actor.did);
    onSelect(actor.did, actor.pds);
  }

  function selectAndFocus(actor: FullActor) {
    select(actor);
    setSearchQuery('');
    setShowSuggestions(false);
    // Scroll the card into view in the grid
    setTimeout(() => {
      const card = gridRef.current?.querySelector<HTMLElement>(`[data-did="${actor.did}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  const selectedActor = actors.find((a) => a.did === selectedDid);

  return (
    <div className={`${styles.wrap} ${locked ? styles.locked : ''}`}>
      <div className={styles.title}>Choose Your Character*</div>
      <div className={styles.divider} />
      <p className={styles.footnote}>
        * Haven't made your character yet?{' '}
        <a
          href="https://rpg.actor/generator"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footnoteLink}
        >
          Create your character at rpg.actor
        </a>{' '}
        and you'll appear in this list.
      </p>
      <SpritePreview actor={selectedActor} />
      <div className={styles.divider} />
      {!loading && actors.length > 0 && (
        <div className={styles.searchWrap}>
          <input
            ref={searchRef}
            className={styles.searchInput}
            type="text"
            placeholder="search characters…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => {
              setShowSuggestions(true);
            }}
            onBlur={() =>
              setTimeout(() => {
                setShowSuggestions(false);
              }, 150)
            }
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                setShowSuggestions(false);
              }
              if (e.key === 'Enter' && suggestions[0]) selectAndFocus(suggestions[0]);
            }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className={styles.suggestions}>
              {suggestions.map((a) => (
                <li key={a.did}>
                  <button
                    className={`${styles.suggestionItem} ${a.did === selectedDid ? styles.suggestionSelected : ''}`}
                    onMouseDown={() => {
                      selectAndFocus(a);
                    }}
                    type="button"
                  >
                    {a.displayName?.trim() || a.handle}
                    {a.displayName && (
                      <span className={styles.suggestionHandle}>@{a.handle.split('.')[0]}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>loading…</div>
      ) : actors.length === 0 ? (
        <div className={styles.loading}>- - -</div>
      ) : (
        <div className={styles.grid} ref={gridRef}>
          {actors.map((a) => (
            <SpriteCard
              key={a.did}
              actor={a}
              selected={a.did === selectedDid}
              onSelect={() => {
                select(a);
              }}
              dataDid={a.did}
            />
          ))}
        </div>
      )}
    </div>
  );
}
