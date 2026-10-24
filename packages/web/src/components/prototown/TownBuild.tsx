import { useTranslation } from 'react-i18next';
import type { TownBuiltinId } from '@protoimsg/shared';
import type { TownBuildView } from '../../town/WorldEngine';
import type { LayoutSaveStatus } from './useLayoutSaver';
import styles from './TownBuild.module.css';

interface BuildTrayProps {
  view: TownBuildView;
  status: LayoutSaveStatus;
  onSelect: (id: TownBuiltinId) => void;
  onPlace: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onDone: () => void;
}

/**
 * Build mode's tray: the pieces you can place, what you can do with the
 * tile in front of you, and whether your design is saved. It never takes
 * focus, so you keep walking while it's open.
 */
export function BuildTray({
  view,
  status,
  onSelect,
  onPlace,
  onRemove,
  onRetry,
  onDone,
}: BuildTrayProps) {
  const { t } = useTranslation('common');
  return (
    <section className={styles.tray} aria-labelledby="town-build-title" data-town-build>
      <div className={styles.header}>
        <h2 id="town-build-title" className={styles.title}>
          {t(view.space === 'home' ? 'town.build.titleHome' : 'town.build.titleYard')}
        </h2>
        <span
          className={`${styles.status} ${status === 'error' ? styles.statusError : ''}`}
          role="status"
        >
          {status === 'saving' && t('town.build.saving')}
          {status === 'saved' && t('town.build.saved')}
          {status === 'error' && t('town.build.saveFailed')}
        </span>
        {status === 'error' && (
          <button type="button" className={styles.button} onClick={onRetry}>
            {t('town.build.retry')}
          </button>
        )}
      </div>
      <div className={styles.items} role="group" aria-label={t('town.build.pieces')}>
        {view.items.map((id) => (
          <button
            key={id}
            type="button"
            className={`${styles.item} ${id === view.item ? styles.selected : ''}`}
            aria-pressed={id === view.item}
            onClick={() => {
              onSelect(id);
            }}
          >
            {t(`town.build.items.${id}`)}
          </button>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          aria-disabled={!view.canPlace}
          onClick={() => {
            if (view.canPlace) onPlace();
          }}
        >
          {t('town.build.place')}
        </button>
        <button
          type="button"
          className={styles.button}
          aria-disabled={!view.canRemove}
          onClick={() => {
            if (view.canRemove) onRemove();
          }}
        >
          {t('town.build.remove')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('town.build.done')}
        </button>
        <span className={styles.hint}>
          {view.full ? t('town.build.full') : t('town.build.hint')}
        </span>
      </div>
    </section>
  );
}

interface BuildConsentProps {
  onAllow: () => void;
  onCancel: () => void;
}

/** Saving designs needs a permission older sessions don't have yet. */
export function BuildConsent({ onAllow, onCancel }: BuildConsentProps) {
  const { t } = useTranslation('common');
  return (
    <section className={styles.tray} aria-labelledby="town-build-consent-title">
      <div className={styles.header}>
        <h2 id="town-build-consent-title" className={styles.title}>
          {t('town.build.consent.title')}
        </h2>
      </div>
      <p className={styles.body}>{t('town.build.consent.body')}</p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onAllow}>
          {t('town.build.consent.allow')}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          {t('town.build.consent.notNow')}
        </button>
      </div>
    </section>
  );
}
