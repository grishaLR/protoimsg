import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TileErrorEvent, TileMothership } from '@dasl/tile-loader';
import { useAuth } from '../../hooks/useAuth';
import { useAtmochiTile } from '../../hooks/useAtmochiTile';
import styles from './AtmochiPet.module.css';

// One mothership for every tile on the page, loaded only once a pet is run.
let mothership: Promise<TileMothership> | undefined;

function getMothership(): Promise<TileMothership> {
  mothership ??= (async () => {
    const [{ TileMothership: Mothership }, { ATTileLoader }] = await Promise.all([
      import('@dasl/tile-loader'),
      import('@dasl/tile-loader/at'),
    ]);
    const tl = new Mothership();
    tl.init();
    tl.addLoader(new ATTileLoader());
    return tl;
  })().catch((err: unknown) => {
    mothership = undefined;
    throw err;
  });
  return mothership;
}

/**
 * The loading mark: a little egg-shaped virtual pet rocks to wind up, hops,
 * turns once in the air and lands with a squash. `idle` is the same pet at
 * rest, only rocking now and then. Still under reduced motion.
 */
function PetSpinner({ idle = false }: { idle?: boolean }) {
  return (
    <svg
      className={`${styles.spinner} ${idle ? styles.idle : ''}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <ellipse className={styles.shadow} cx="32" cy="58" rx="14" ry="3" />
      <g className={styles.hop}>
        <g className={styles.turn}>
          {/* keychain loop */}
          <circle className={styles.line} cx="32" cy="9.5" r="2.5" />
          {/* shell */}
          <path
            className={styles.shell}
            d="M32 12c-9 0-16 10.5-16 21.5a16 16 0 0 0 32 0C48 22.5 41 12 32 12Z"
          />
          {/* screen */}
          <rect className={styles.screen} x="23" y="23" width="18" height="15" rx="3" />
          {/* face */}
          <path className={styles.line} d="M28 28.5v1.5M36 28.5v1.5M28.5 33c2 1.8 5 1.8 7 0" />
          {/* buttons */}
          <path className={styles.line} d="M27 43h.01M32 44.5h.01M37 43h.01" />
        </g>
      </g>
    </svg>
  );
}

/** Pets this viewer chose to meet, for as long as the page lives. */
const metPets = new Set<string>();

/**
 * An actor's Atmochi pet, shown as the Web Tile they published from
 * atmochi.pet. Renders nothing when they have no published pet.
 *
 * A tile is whatever its owner wrote to their repo: nothing proves it is an
 * Atmochi. So someone else's tile does not run until the viewer asks to meet
 * it; only your own runs on sight. Once running it is in the loader's
 * sandboxed cross-origin frame, gets no input until it is pressed, cannot
 * keep the keyboard, and its links open only through a prompt that names the
 * destination.
 */
export function AtmochiPet({ pds, did, handle }: { pds: string; did: string; handle: string }) {
  const { t } = useTranslation();
  const { did: viewerDid } = useAuth();
  const { data: pet, isPending } = useAtmochiTile(did, pds);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef(false);
  const [met, setMet] = useState(() => metPets.has(did));
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const uri = pet?.uri;
  const name = pet?.name ?? 'Atmochi';
  const run = met || did === viewerDid;
  const playLabel = t('atmochi.play', { name });
  // atmochi.pet knows a pet's room by its owner's handle only.
  const roomUrl = handle && handle !== 'handle.invalid' ? `https://atmochi.pet/@${handle}` : null;

  useEffect(() => {
    const box = frameBoxRef.current;
    if (!run || !uri || !box) return;
    const ac = new AbortController();
    let teardown: (() => void) | undefined;

    const fail = () => {
      if (ac.signal.aborted) return;
      teardown?.();
      teardown = undefined;
      setFailed(true);
    };

    void (async () => {
      const [tl, { tileLinks, linkPrompt }, { engage, guardFocus }] = await Promise.all([
        getMothership(),
        import('@dasl/tile-loader/link'),
        import('@dasl/tile-loader/guard'),
      ]);
      const tile = await tl.loadTile(uri);
      if (ac.signal.aborted) return;
      if (!tile) {
        fail();
        return;
      }

      tile.addEventListener(
        'error',
        (ev) => {
          const { reason, stage } = ev as TileErrorEvent;
          // Past the dock, a tile that timed out is only slow and still loads.
          // One whose dock or origin never answered is not coming.
          if (reason !== 'timeout' || stage === 'dock' || stage === 'shuttle') fail();
        },
        { signal: ac.signal },
      );
      // Its runtime is up and its page is on the way: the spinner can go.
      tile.addEventListener(
        'load',
        () => {
          setLoading(false);
        },
        { signal: ac.signal },
      );
      // The dock or a guard stopped it: nothing is left to show.
      tile.addEventListener('stopped', fail, { signal: ac.signal });

      const frame = tile.renderContent();
      frame.className = styles.frame ?? '';
      frame.title = name;
      box.append(frame);

      const links = tileLinks(tile, { frame, open: linkPrompt(document.body) });
      const picking = engage(tile, frame, {
        label: playLabel,
        // A viewer who just pressed "meet" has picked it already.
        start: pickedRef.current ? 'engaged' : 'idle',
      });
      const focus = guardFocus(tile, frame, { engaged: () => picking.engaged });

      teardown = () => {
        links.stop();
        focus.stop();
        picking.stop();
        frame.remove();
        void tile.close();
      };
    })().catch(fail);

    return () => {
      ac.abort();
      teardown?.();
    };
  }, [run, uri, name, playLabel]);

  if (failed || (!isPending && !pet)) return null;

  if (pet && !run) {
    return (
      <button
        type="button"
        className={styles.meet}
        onClick={() => {
          metPets.add(did);
          pickedRef.current = true;
          setMet(true);
        }}
      >
        <PetSpinner idle />
        <span className={styles.meetLabel}>{t('atmochi.meet', { name })}</span>
      </button>
    );
  }

  // Still finding out whether there is a pet: the box and its spinner show
  // only after a beat, so a quick "no" never flashes them.
  return (
    <div className={`${styles.pet} ${isPending ? styles.checking : ''}`}>
      <div className={styles.stage}>
        <div ref={frameBoxRef} className={styles.frameBox} />
        {loading && (
          <div className={styles.loading} role="status" aria-label={t('atmochi.loading', { name })}>
            <PetSpinner />
          </div>
        )}
      </div>
      {pet && !loading && roomUrl && (
        <a
          className={styles.visit}
          // eslint-disable-next-line no-restricted-syntax -- https base URL + the actor's handle
          href={roomUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('atmochi.visit', { name })}
        </a>
      )}
      {pet && (
        <a
          className={styles.credit}
          href="https://atmochi.pet"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by atmochi.pet
        </a>
      )}
    </div>
  );
}
