import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TownGuide.module.css';

/** What the guide can tell you about (keys under `town.guide.topics`). */
const TOPICS = ['what', 'look', 'design', 'talk', 'visible', 'around', 'help'] as const;
type Topic = (typeof TOPICS)[number];

interface TownGuideProps {
  /**
   * Where you can send him: from your yard to the square, or (once sent)
   * from the square back to your yard. null: nowhere from here.
   */
  move: 'toSquare' | 'toYard' | null;
  onMove: () => void;
  /** You asked something: he answers (in a speech bubble, in the world). */
  onAsk: (answer: string) => void;
  onClose: () => void;
}

/**
 * Talking to the square's guide (ProtoBuddy): pick a question and he answers
 * in a speech bubble over his head. Walking away (or Escape) ends the chat.
 */
export function TownGuide({ move, onMove, onAsk, onClose }: TownGuideProps) {
  const { t } = useTranslation('common');
  const [asked, setAsked] = useState<Topic | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Focus the card itself, not a question: Escape works, Tab reaches the
  // questions, and Space (the sprint key) can't press one by accident.
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  return (
    // Keys stay in the card while it has focus: arrows scroll the list instead
    // of walking you away (which would close it). Escape still closes.
    <section
      ref={sectionRef}
      tabIndex={-1}
      data-town-keys="own"
      className={styles.guide}
      aria-labelledby="town-guide-title"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id="town-guide-title" className={styles.title}>
          {t('town.guide.name')}
        </h2>
        <button type="button" className={styles.button} onClick={onClose}>
          {t('town.guide.close')}
        </button>
      </div>
      <div className={styles.body}>
        <p className={styles.intro}>{t('town.guide.intro')}</p>
        <ul className={styles.list}>
          {TOPICS.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={styles.item}
                aria-current={asked === id ? 'true' : undefined}
                onClick={() => {
                  setAsked(id);
                  onAsk(t(`town.guide.topics.${id}.a`));
                }}
              >
                {t(`town.guide.topics.${id}.q`)}
              </button>
            </li>
          ))}
        </ul>
        {move && (
          <button type="button" className={styles.button} onClick={onMove}>
            {t(move === 'toSquare' ? 'town.guide.sendAway' : 'town.guide.bringBack', {
              name: t('town.guide.name'),
            })}
          </button>
        )}
      </div>
    </section>
  );
}

interface TownGuidePromptProps {
  onTalk: () => void;
}

/** Beside the guide: a button to talk (touch has no E key). */
export function TownGuidePrompt({ onTalk }: TownGuidePromptProps) {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      className={styles.prompt}
      title={t('town.guide.talkHint')}
      aria-keyshortcuts="E"
      onClick={onTalk}
    >
      {t('town.guide.talk', { name: t('town.guide.name') })}
    </button>
  );
}
