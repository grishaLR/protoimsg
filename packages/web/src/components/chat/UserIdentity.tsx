import { useState, useCallback } from 'react';
import { useProfile } from '../../contexts/ProfileContext';
import { useModeration } from '../../hooks/useModeration';
import { useAuth } from '../../hooks/useAuth';
import { isSafeUrl } from '../../lib/sanitize';
import { UserContextMenu } from './UserContextMenu';
import styles from './UserIdentity.module.css';

interface UserIdentityProps {
  did: string;
  showAvatar?: boolean;
  size?: 'sm' | 'md';
  /** Enable right-click context menu with Add Buddy / Block / Report */
  enableContextMenu?: boolean;
}

function truncateDid(did: string): string {
  if (did.length <= 20) return did;
  return did.slice(0, 14) + '...' + did.slice(-4);
}

export function UserIdentity({
  did,
  showAvatar = false,
  size = 'sm',
  enableContextMenu = false,
}: UserIdentityProps) {
  const profile = useProfile(did);
  const moderation = useModeration(did);
  const { did: currentUserDid } = useAuth();
  const [avatarRevealed, setAvatarRevealed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!enableContextMenu || did === currentUserDid) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [enableContextMenu, did, currentUserDid],
  );

  if (moderation.shouldFilter) {
    return <span className={styles.identity}>[Hidden User]</span>;
  }

  const displayText = profile ? `@${profile.handle}` : truncateDid(did);
  const avatarSize = size === 'md' ? styles.avatarMd : styles.avatarSm;
  const initialSize = size === 'md' ? styles.initialAvatarMd : styles.initialAvatarSm;
  const avatarPx = size === 'md' ? 24 : 20;
  const avatarBlurred = moderation.shouldBlur && !avatarRevealed;
  const hasRealAvatar = profile?.avatarUrl && isSafeUrl(profile.avatarUrl);
  const initial = (profile?.handle[0] ?? did.at(-1) ?? '?').toUpperCase();

  return (
    <span className={styles.identity} onContextMenu={handleContextMenu}>
      {showAvatar &&
        (hasRealAvatar ? (
          <img
            className={`${styles.avatar} ${avatarSize} ${avatarBlurred ? styles.blurred : ''}`}
            // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
            src={profile.avatarUrl}
            width={avatarPx}
            height={avatarPx}
            alt=""
            onClick={
              avatarBlurred
                ? () => {
                    setAvatarRevealed(true);
                  }
                : undefined
            }
            title={avatarBlurred ? 'Click to reveal' : undefined}
          />
        ) : (
          <span className={`${styles.initialAvatar} ${initialSize}`} aria-hidden="true">
            {initial}
          </span>
        ))}
      <span className={styles.handle} title={did}>
        {displayText}
      </span>
      {moderation.shouldAlert && (
        <span className={styles.alertBadge} title="Warning">
          &#9888;
        </span>
      )}
      {moderation.shouldInform && (
        <span className={styles.infoBadge} title="Info">
          &#9432;
        </span>
      )}
      {contextMenu && (
        <UserContextMenu
          did={did}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}
    </span>
  );
}
