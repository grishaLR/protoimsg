import { useState, useCallback, useRef } from 'react';
import { useProfile } from '../../contexts/ProfileContext';
import { useModeration } from '../../hooks/useModeration';
import { useAuth } from '../../hooks/useAuth';
import { isSafeUrl } from '../../lib/sanitize';
import { useViewProfile } from '../../contexts/ViewProfileContext';
import { UserContextMenu } from './UserContextMenu';
import { UserPopoverCard } from './UserPopoverCard';
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
  const onViewProfile = useViewProfile();
  const profile = useProfile(did);
  const moderation = useModeration(did);
  const { did: currentUserDid } = useAuth();
  const [avatarRevealed, setAvatarRevealed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [popover, setPopover] = useState<DOMRect | null>(null);
  const identityRef = useRef<HTMLSpanElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!enableContextMenu || did === currentUserDid) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [enableContextMenu, did, currentUserDid],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (did === currentUserDid) return;
      // Don't open popover if clicking a blurred avatar to reveal it
      if (styles.blurred && (e.target as HTMLElement).classList.contains(styles.blurred)) return;
      const rect = identityRef.current?.getBoundingClientRect();
      if (rect) setPopover(rect);
    },
    [did, currentUserDid],
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
    <span
      className={`${styles.identity} ${did !== currentUserDid ? styles.clickable : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      ref={identityRef}
      role={did !== currentUserDid ? 'button' : undefined}
      tabIndex={did !== currentUserDid ? 0 : undefined}
      onKeyDown={
        did !== currentUserDid
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const rect = identityRef.current?.getBoundingClientRect();
                if (rect) setPopover(rect);
              }
            }
          : undefined
      }
    >
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
                ? (e) => {
                    e.stopPropagation();
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
      {popover && (
        <UserPopoverCard
          did={did}
          anchorRect={popover}
          onClose={() => {
            setPopover(null);
          }}
          onViewProfile={onViewProfile}
        />
      )}
    </span>
  );
}
