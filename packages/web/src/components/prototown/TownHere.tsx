import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TownHere.module.css';

/** Shared collator: sorting up to 100 names shouldn't build one per compare. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

interface TownHereProps {
  /**
   * Others in your scene you may see (server-filtered: blocks, mutuals,
   * friends of friends) — `dids` capped, `total` exact. Null until the server
   * has said for this scene, so a crowded square never flashes "0".
   */
  here: { dids: readonly string[]; total: number } | null;
  /** Owned by the panel: names are only fetched while the list is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nameOf: (did: string) => string;
  /** Class for the toggle button, so it matches the other HUD buttons. */
  buttonClassName: string;
}

/**
 * "Who's here": everyone in the space you're in, not just the avatars on
 * screen. The list comes from the server, which only includes people you
 * could see anyway — so friends-of-friends mode in the square is respected
 * both ways.
 */
export function TownHere({ here, open, onOpenChange, nameOf, buttonClassName }: TownHereProps) {
  const { t } = useTranslation('common');
  const panelId = useId();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Focus the list (arrows scroll it) or, if there's none yet, the panel —
  // either way Escape works and the keys stay off the avatar.
  useEffect(() => {
    if (open) (listRef.current ?? panelRef.current)?.focus();
  }, [open]);

  const close = (): void => {
    onOpenChange(false);
    buttonRef.current?.focus();
  };

  const dids = here?.dids;
  const names = useMemo(
    () =>
      open && dids
        ? dids
            .map((did) => ({ did, name: nameOf(did) }))
            .sort((a, b) => collator.compare(a.name, b.name))
        : [],
    [open, dids, nameOf],
  );
  const more = here ? here.total - here.dids.length : 0;

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        {here ? t('town.here.button', { count: here.total }) : t('town.here.title')}
      </button>
      {open && (
        <section
          ref={panelRef}
          id={panelId}
          tabIndex={-1}
          className={styles.panel}
          aria-labelledby={titleId}
          data-town-keys="own"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        >
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {t('town.here.title')}
            </h2>
            <button type="button" className={styles.close} onClick={close}>
              {t('town.here.close')}
            </button>
          </div>
          {here?.total === 0 && <p className={styles.note}>{t('town.here.empty')}</p>}
          {here && here.total > 0 && (
            // Focusable so the keyboard can scroll a long list.
            <ul ref={listRef} className={styles.list} tabIndex={0} aria-labelledby={titleId}>
              {names.map(({ did, name }) => (
                <li key={did} className={styles.item}>
                  {name}
                </li>
              ))}
            </ul>
          )}
          {more > 0 && <p className={styles.note}>{t('town.here.more', { count: more })}</p>}
        </section>
      )}
    </div>
  );
}
