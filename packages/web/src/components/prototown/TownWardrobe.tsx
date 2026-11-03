import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@atproto/api';
import { RPG_ITEM_COLLECTION } from '@protoimsg/shared';
import type { TownDisplayed, TownDisplayLook } from '@protoimsg/shared';
import { resolvePdsForDid } from '../../lib/resolve-pds';
import { loadItemArt } from '../../town/displayArt';
import { picturesOf } from '../../town/wardrobeItems';
import styles from './TownBuild.module.css';

/** Plenty for anyone's inventory; the list is read once per opening. */
const MAX_PAGES = 5;

interface OwnedItem {
  uri: string;
  title: string;
  /** The record, for its art. */
  value: Record<string, unknown>;
}

/** An item's two pictures, cut out (null: it hasn't got that one). */
interface Pictures {
  icon: HTMLCanvasElement | null;
  worn: HTMLCanvasElement | null;
}

/** Pictures already cut out, by item URI. */
const pictureCache = new Map<string, Pictures>();
const MAX_PICTURES = 300;

/** Both of an item's pictures, cut the way the wardrobe shows them. */
async function loadPictures(
  item: OwnedItem,
  owner: string,
  pds: string,
  signal: AbortSignal,
): Promise<Pictures> {
  const pics = await picturesOf(item.value, owner, pds);
  const [icon, worn] = await Promise.all([
    pics.icon ? loadItemArt(pics.icon, signal) : null,
    pics.worn ? loadItemArt(pics.worn, signal) : null,
  ]);
  return { icon, worn };
}

/** One picture, drawn crisp onto its own canvas (or an empty box). */
function Picture({ art }: { art: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !art) return;
    c.width = art.width;
    c.height = art.height;
    c.getContext('2d')?.drawImage(art, 0, 0);
  }, [art]);
  return (
    <span className={styles.thumb} aria-hidden="true">
      {art && <canvas ref={ref} />}
    </span>
  );
}

interface ItemChoiceProps {
  item: OwnedItem;
  owner: string;
  pds: string | null;
  /** Chosen, and how it shows (null: not chosen). */
  picked: TownDisplayed | null;
  /** The wardrobe is full (and this isn't on it). */
  full: boolean;
  onToggle: () => void;
  onLook: (look: TownDisplayLook) => void;
}

/**
 * One of your items: tick it to show it. Chosen, and with both an icon and a
 * worn look, you choose which; the preview is what the wardrobe will show.
 * Its pictures load when it scrolls into view.
 */
function ItemChoice({ item, owner, pds, picked, full, onToggle, onLook }: ItemChoiceProps) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  const [pictures, setPictures] = useState<Pictures | undefined>(() => pictureCache.get(item.uri));

  useEffect(() => {
    const el = ref.current;
    if (pictures || !pds || !el) return;
    const ac = new AbortController();
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      void loadPictures(item, owner, pds, ac.signal).then((p) => {
        if (ac.signal.aborted) return;
        pictureCache.set(item.uri, p);
        if (pictureCache.size > MAX_PICTURES) {
          const oldest = pictureCache.keys().next().value;
          if (oldest !== undefined) pictureCache.delete(oldest);
        }
        setPictures(p);
      });
    });
    seen.observe(el);
    return () => {
      seen.disconnect();
      ac.abort();
    };
  }, [item, owner, pds, pictures]);

  const look: TownDisplayLook = picked?.look ?? 'icon';
  // What the wardrobe would show: the chosen look, else whichever there is.
  const shown =
    (look === 'worn' ? pictures?.worn : pictures?.icon) ?? pictures?.icon ?? pictures?.worn ?? null;
  const both = !!pictures?.icon && !!pictures.worn;

  return (
    <div ref={ref} className={styles.card}>
      <label className={styles.choice}>
        <input type="checkbox" checked={!!picked} disabled={!picked && full} onChange={onToggle} />
        <Picture art={shown} />
        <span>{item.title}</span>
      </label>
      {picked && both && (
        <div
          className={styles.looks}
          role="group"
          aria-label={t('town.build.wardrobe.look', { title: item.title })}
        >
          {(['icon', 'worn'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`${styles.item} ${l === look ? styles.selected : ''}`}
              aria-pressed={l === look}
              onClick={() => {
                onLook(l);
              }}
            >
              {t(l === 'icon' ? 'town.build.wardrobe.lookIcon' : 'town.build.wardrobe.lookWorn')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Your rpg.actor items, read from your own repo (newest first). */
async function loadOwnedItems(agent: Agent, did: string, signal: AbortSignal) {
  const out: OwnedItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await agent.com.atproto.repo.listRecords(
      { repo: did, collection: RPG_ITEM_COLLECTION, limit: 100, cursor },
      { signal },
    );
    for (const r of res.data.records) {
      const title = (r.value as { title?: unknown }).title;
      if (typeof title === 'string' && title.trim()) {
        out.push({ uri: r.uri, title: title.trim(), value: r.value as Record<string, unknown> });
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return out;
}

interface WardrobePickerProps {
  agent: Agent;
  did: string;
  /** How many items the wardrobe holds. */
  slots: number;
  /** What's on it now, in order. */
  chosen: readonly TownDisplayed[];
  onSave: (display: TownDisplayed[]) => void;
  onCancel: () => void;
}

/**
 * Choose which of your rpg.actor items your wardrobe shows. Nothing is shown
 * until you pick; unticking everything empties it again. Each shows as its
 * icon, or as worn (the front-facing frame), whichever you choose.
 *
 * A modal dialog: the town is inert while it's open (no walking off and
 * moving the wardrobe mid-choice), Escape cancels, and closing returns focus
 * to the button that opened it.
 */
export function WardrobePicker({
  agent,
  did,
  slots,
  chosen,
  onSave,
  onCancel,
}: WardrobePickerProps) {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<OwnedItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<TownDisplayed[]>(() => [...chosen]);
  const [attempt, setAttempt] = useState(0);
  // Your PDS, where your items' icons live (looked up once per opening).
  const [pds, setPds] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void resolvePdsForDid(did).then((p) => {
      if (live) setPds(p);
    });
    return () => {
      live = false;
    };
  }, [did]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** Set by "Show these" just before closing: what to save (else it's a cancel). */
  const result = useRef<TownDisplayed[] | null>(null);
  const done = useRef({ onSave, onCancel });
  done.current = { onSave, onCancel };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setFailed(false);
    loadOwnedItems(agent, did, ac.signal)
      .then((owned) => {
        if (ac.signal.aborted) return;
        setItems(owned);
        // Anything no longer in your repo can't be shown: let it go.
        const have = new Set(owned.map((i) => i.uri));
        setPicked((p) => p.filter((d) => have.has(d.item)));
      })
      .catch(() => {
        if (!ac.signal.aborted) setFailed(true);
      });
    return () => {
      ac.abort();
    };
  }, [agent, did, attempt]);

  const full = picked.length >= slots;
  const toggle = (uri: string): void => {
    setPicked((p) =>
      p.some((d) => d.item === uri)
        ? p.filter((d) => d.item !== uri)
        : p.length < slots
          ? [...p, { item: uri }]
          : p,
    );
  };
  const setLook = (uri: string, look: TownDisplayLook): void => {
    setPicked((p) =>
      p.map((d) => (d.item !== uri ? d : look === 'worn' ? { item: uri, look } : { item: uri })),
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.tray} ${styles.dialog}`}
      aria-labelledby="town-wardrobe-title"
      onClose={() => {
        const chosen = result.current;
        result.current = null;
        if (chosen) done.current.onSave(chosen);
        else done.current.onCancel();
      }}
    >
      <div className={styles.header}>
        <h2 id="town-wardrobe-title" className={styles.title}>
          {t('town.build.wardrobe.title')}
        </h2>
        {items && items.length > 0 && (
          <span className={styles.status} role="status">
            {t('town.build.wardrobe.count', { chosen: picked.length, slots })}
          </span>
        )}
      </div>
      <p className={styles.body}>{t('town.build.wardrobe.body', { count: slots })}</p>
      {failed ? (
        <p className={styles.body} role="alert">
          {t('town.build.wardrobe.loadFailed')}{' '}
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            {t('town.build.retry')}
          </button>
        </p>
      ) : items === null ? (
        <p className={styles.body} role="status">
          {t('town.build.wardrobe.loading')}
        </p>
      ) : items.length === 0 ? (
        <p className={styles.body}>{t('town.build.wardrobe.empty')}</p>
      ) : (
        <fieldset className={styles.choices} aria-labelledby="town-wardrobe-title">
          {items.map((item) => (
            <ItemChoice
              key={item.uri}
              item={item}
              owner={did}
              pds={pds}
              picked={picked.find((d) => d.item === item.uri) ?? null}
              full={full}
              onToggle={() => {
                toggle(item.uri);
              }}
              onLook={(look) => {
                setLook(item.uri, look);
              }}
            />
          ))}
        </fieldset>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          aria-disabled={items === null}
          onClick={() => {
            if (items === null) return;
            result.current = picked;
            dialogRef.current?.close();
          }}
        >
          {t('town.build.wardrobe.save')}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            dialogRef.current?.close();
          }}
        >
          {t('town.build.wardrobe.cancel')}
        </button>
        {full && <span className={styles.hint}>{t('town.build.wardrobe.full')}</span>}
      </div>
    </dialog>
  );
}
