import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBskyEmbedImages } from '@atproto/api';
import styles from './ImageLightbox.module.css';

interface ImageLightboxProps {
  images: AppBskyEmbedImages.ViewImage[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const { t } = useTranslation('feed');
  const [index, setIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  const image = images[index];
  const hasMultiple = images.length > 1;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    return () => {
      previousActiveRef.current?.focus();
    };
  }, []);

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }, [images.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  if (!image) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.lightbox}
      onClose={onClose}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.content}>
        <button
          className={styles.closeButton}
          onClick={onClose}
          type="button"
          aria-label={t('post.lightboxClose')}
        >
          &times;
        </button>

        {hasMultiple && (
          <button
            className={`${styles.navButton} ${styles.navPrev}`}
            onClick={goPrev}
            type="button"
            aria-label={t('post.lightboxPrev')}
          >
            &#8249;
          </button>
        )}

        <img
          className={styles.image}
          // eslint-disable-next-line no-restricted-syntax -- fullsize URL from ATProto image embed
          src={image.fullsize}
          alt={image.alt || ''}
        />

        {hasMultiple && (
          <button
            className={`${styles.navButton} ${styles.navNext}`}
            onClick={goNext}
            type="button"
            aria-label={t('post.lightboxNext')}
          >
            &#8250;
          </button>
        )}

        <div className={styles.footer}>
          {hasMultiple && (
            <span className={styles.counter}>
              {t('post.lightboxCounter', { current: index + 1, total: images.length })}
            </span>
          )}
          {image.alt && <p className={styles.altText}>{image.alt}</p>}
        </div>
      </div>
    </dialog>
  );
}
