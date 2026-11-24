import { useEffect, useRef, useState } from 'react';
import { PDS_URL, GAME_MASTER_DID } from '../../lib/config';
import { blobUrl } from '../../lib/record-blobs';
import type { AcceptedGift } from '../../hooks/useGiftAcceptance';
import { isSafeUrl } from '../../lib/sanitize';
import styles from './GiftUnlockedModal.module.css';

interface Props {
  gift: AcceptedGift;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function GiftUnlockedModal({ gift, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [onClose]);

  // Set when the icon fails to load, so the sprite sheet is shown instead.
  const [iconFailed, setIconFailed] = useState(false);
  const iconSrc = gift.iconCid ? blobUrl(PDS_URL, GAME_MASTER_DID, gift.iconCid) : null;
  const sheetSrc = blobUrl(PDS_URL, GAME_MASTER_DID, gift.assetCid);
  const text = gift.description ?? gift.context ?? 'A rare item has been added to your inventory.';

  return (
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gift-title">
        <div className={styles.header}>
          <h2 className={styles.title} id="gift-title">
            {gift.title}
          </h2>
          <span className={styles.badge}>Item</span>
        </div>

        <div className={styles.body}>
          <div className={styles.spriteWrap}>
            {iconSrc && !iconFailed && isSafeUrl(iconSrc) ? (
              <img
                className={styles.icon}
                // eslint-disable-next-line no-restricted-syntax -- validated by isSafeUrl() above
                src={iconSrc}
                alt={gift.title}
                onError={() => {
                  setIconFailed(true);
                }}
              />
            ) : (
              // No icon (older gives carry none) or it did not load: crop the
              // layerable 3x4 sprite sheet (assetCid) to a single cell instead.
              <div
                className={styles.sprite}
                style={{ backgroundImage: `url(${sheetSrc})` }}
                role="img"
                aria-label={gift.title}
              />
            )}
          </div>

          <div className={styles.info}>
            <p className={styles.description}>{text}</p>
            <div className={styles.meta}>
              <span className={styles.metaFrom}>
                from @{gift.providerHandle ?? 'games.protoimsg.app'} · {formatDate(gift.givenAt)}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.closeBtn} onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
