import type { GameStatusControls } from '../../hooks/useGameStatus';
import styles from './ShareStatusToggle.module.css';

/**
 * The consent switch for the live "now playing" status
 * (`games.atmosphere.status`, see `useGameStatus`). Off by default: the status
 * is a public record in the player's own repo, so it is only ever written for
 * someone who ticked this. The label says exactly what the record contains —
 * the game and the mode — and who can see it.
 */
export function ShareStatusToggle({ status }: { status: GameStatusControls }) {
  if (!status.available) return null;
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={status.shareStatus}
        onChange={(e) => {
          status.setShareStatus(e.target.checked);
        }}
      />
      <span>
        Publicly show which game and mode I&apos;m playing, while I play. Anyone on the AT Protocol
        network can see it.
        {status.needsPermission && ' Turning this on asks your account for permission first.'}
      </span>
    </label>
  );
}
