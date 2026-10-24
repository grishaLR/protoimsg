import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TownSignpost.module.css';

interface TownSignpostProps {
  /** Owners of neighborhoods you can visit that didn't fit on the gate row. */
  owners: readonly string[];
  nameOf: (did: string) => string;
  onVisit: (owner: string) => void;
  onClose: () => void;
}

/**
 * The square's signpost: every neighborhood you can visit beyond the gate
 * row. Opens while you stand on the signpost; walking off (or Escape) closes it.
 */
export function TownSignpost({ owners, nameOf, onVisit, onClose }: TownSignpostProps) {
  const { t } = useTranslation('common');
  const sectionRef = useRef<HTMLElement>(null);

  // Focus the list itself, not a neighborhood: Escape works, Tab reaches the
  // entries, and Space (the sprint key) can't whisk you off by accident.
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className={styles.signpost}
      aria-labelledby="town-signpost-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id="town-signpost-title" className={styles.title}>
          {t('town.signpost.title')}
        </h2>
        <button type="button" className={styles.close} onClick={onClose}>
          {t('town.signpost.close')}
        </button>
      </div>
      <ul className={styles.list}>
        {owners.map((owner) => (
          <li key={owner}>
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                onVisit(owner);
              }}
            >
              {nameOf(owner)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
