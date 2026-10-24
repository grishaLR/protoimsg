import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TownKnock.module.css';

interface KnockPromptProps {
  ownerName: string;
  /** Waiting for an answer. */
  knocking: boolean;
  onKnock: () => void;
  onCancel: () => void;
}

/** At someone's door (you're in their inner circle): knock, or walk on. */
export function KnockPrompt({ ownerName, knocking, onKnock, onCancel }: KnockPromptProps) {
  const { t } = useTranslation('common');
  const sectionRef = useRef<HTMLElement>(null);

  // Focus the prompt itself, not its Knock button: Escape works, Tab reaches
  // the buttons, and Space (the sprint key) can't knock by accident.
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className={styles.prompt}
      aria-label={t('town.knock.prompt', { name: ownerName })}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {knocking ? (
        <>
          <p className={styles.text}>{t('town.knock.knocking')}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onCancel}>
              {t('town.knock.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.text}>{t('town.knock.prompt', { name: ownerName })}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onKnock}>
              {t('town.knock.knock')}
            </button>
            <button type="button" className={styles.secondary} onClick={onCancel}>
              {t('town.knock.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Someone asking you something — a knock at your door, or to join your conversation. */
export interface PendingRequest {
  id: string;
  from: string;
  /** A knock from someone you said "not now" to recently. */
  again?: boolean;
  /** When it runs out on the server (the card goes with it). */
  until: number;
}

interface RequestCardsProps {
  requests: readonly PendingRequest[];
  /** The card's sentence for a request. */
  textOf: (request: PendingRequest) => string;
  acceptLabel: string;
  declineLabel: string;
  onAnswer: (id: string, accept: boolean) => void;
  /** Lift the cards clear of a knock prompt showing in the same spot. */
  abovePrompt?: boolean;
}

/**
 * Someone's asking. Not a modal and doesn't take focus — you might be
 * mid-sentence — but it's reachable by Tab (the panel announces each request
 * through its live region).
 */
export function RequestCards({
  requests,
  textOf,
  acceptLabel,
  declineLabel,
  onAnswer,
  abovePrompt = false,
}: RequestCardsProps) {
  return (
    <div className={`${styles.cards} ${abovePrompt ? styles.abovePrompt : ''}`}>
      {requests.map((r) => (
        <section key={r.id} className={styles.card} aria-labelledby={`town-req-${r.id}`}>
          <p id={`town-req-${r.id}`} className={styles.text}>
            {textOf(r)}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                onAnswer(r.id, true);
              }}
            >
              {acceptLabel}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                onAnswer(r.id, false);
              }}
            >
              {declineLabel}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

interface GuestListProps {
  guests: readonly string[];
  nameOf: (did: string) => string;
  onAskToLeave: (did: string) => void;
}

/** Who's visiting your home, each with a way to end their visit. */
export function GuestList({ guests, nameOf, onAskToLeave }: GuestListProps) {
  const { t } = useTranslation('common');
  return (
    <section className={styles.guests} aria-labelledby="town-guests-title">
      <h2 id="town-guests-title" className={styles.title}>
        {t('town.guests.title')}
      </h2>
      <ul className={styles.list}>
        {guests.map((did) => (
          <li key={did} className={styles.guest}>
            <span id={`town-guest-${did}`} className={styles.name}>
              {nameOf(did)}
            </span>
            <button
              type="button"
              className={styles.secondary}
              aria-describedby={`town-guest-${did}`}
              onClick={() => {
                onAskToLeave(did);
              }}
            >
              {t('town.guests.askToLeave')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
