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
export function AtmochiPet({ pds, did }: { pds: string; did: string }) {
  const { t } = useTranslation();
  const { did: viewerDid } = useAuth();
  const { data: pet } = useAtmochiTile(did, pds);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef(false);
  const [met, setMet] = useState(() => metPets.has(did));
  const [failed, setFailed] = useState(false);

  const uri = pet?.uri;
  const name = pet?.name ?? 'Atmochi';
  const run = met || did === viewerDid;
  const playLabel = t('atmochi.play', { name });

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

  if (!pet || failed) return null;

  if (!run) {
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
        {t('atmochi.meet', { name })}
      </button>
    );
  }

  return (
    <div className={styles.pet}>
      <div ref={frameBoxRef} className={styles.frameBox} />
      <a
        className={styles.credit}
        href="https://atmochi.pet"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by atmochi.pet
      </a>
    </div>
  );
}
