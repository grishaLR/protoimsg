import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useCompose } from '../../hooks/useCompose';
import { useGifCapabilities } from '../../hooks/useGifCapabilities';
import { GifSearchModal } from '../chat/GifSearchModal';
import styles from './FeedComposer.module.css';

interface FeedComposerProps {
  replyTo: AppBskyFeedDefs.PostView | null;
  quoteTo?: AppBskyFeedDefs.PostView | null;
  onClearReply?: () => void;
  onClearQuote?: () => void;
  onPostSuccess?: () => void;
}

export function FeedComposer({
  replyTo,
  quoteTo: externalQuoteTo,
  onClearReply,
  onClearQuote,
  onPostSuccess,
}: FeedComposerProps) {
  const { t } = useTranslation('feed');
  const [expanded, setExpanded] = useState(false);
  const [showGifModal, setShowGifModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { capabilities, hasAnyGifService } = useGifCapabilities();

  const {
    text,
    setText,
    images,
    imageAlts,
    addImage,
    removeImage,
    setImageAlt,
    gif,
    setGif,
    gifAlt,
    setGifAlt,
    setReplyTo,
    quoteTo,
    setQuoteTo,
    posting,
    error,
    graphemeCount,
    canPost,
    submit,
    clear,
  } = useCompose(onPostSuccess);

  // Create stable blob URLs for image previews and revoke on change/unmount
  const imageUrls = useMemo(() => images.map((f) => URL.createObjectURL(f)), [images]);
  useEffect(() => {
    return () => {
      imageUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [imageUrls]);

  // Sync external replyTo into compose state
  useEffect(() => {
    if (replyTo) {
      setReplyTo(replyTo);
      setExpanded(true);
    }
  }, [replyTo, setReplyTo]);

  // Sync external quoteTo into compose state
  useEffect(() => {
    if (externalQuoteTo) {
      setQuoteTo(externalQuoteTo);
      setExpanded(true);
    }
  }, [externalQuoteTo, setQuoteTo]);

  const handleClearReply = useCallback(() => {
    setReplyTo(null);
    onClearReply?.();
  }, [setReplyTo, onClearReply]);

  const handleClearQuote = useCallback(() => {
    setQuoteTo(null);
    onClearQuote?.();
  }, [setQuoteTo, onClearQuote]);

  const handleSubmit = useCallback(async () => {
    await submit();
    setExpanded(false);
  }, [submit]);

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        for (const file of Array.from(files)) {
          addImage(file);
        }
      }
      // Reset input so same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addImage],
  );

  if (!expanded) {
    return (
      <button
        className={styles.collapsed}
        onClick={() => {
          setExpanded(true);
        }}
        type="button"
      >
        {t('composer.collapsed')}
      </button>
    );
  }

  return (
    <div className={styles.composer}>
      {replyTo && (
        <div className={styles.replyContext}>
          <span>{t('composer.replyingTo', { handle: replyTo.author.handle })}</span>
          <button className={styles.clearReply} onClick={handleClearReply} type="button">
            &times;
          </button>
        </div>
      )}

      {quoteTo && (
        <div className={styles.replyContext}>
          <span>{t('composer.quotingPost', { handle: quoteTo.author.handle })}</span>
          <button className={styles.clearReply} onClick={handleClearQuote} type="button">
            &times;
          </button>
        </div>
      )}

      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        placeholder={t('composer.placeholder')}
        rows={4}
        disabled={posting}
      />

      <div className={styles.charCount} data-over={graphemeCount > 300 ? 'true' : undefined}>
        {t('composer.charCount', { count: graphemeCount, max: 300 })}
      </div>

      {images.length > 0 && (
        <div className={styles.imagePreviews}>
          {images.map((file, i) => (
            <div key={`${file.name}${String(file.lastModified)}`} className={styles.imagePreview}>
              {/* eslint-disable-next-line no-restricted-syntax -- blob URL from URL.createObjectURL() */}
              <img src={imageUrls[i]} alt="" />
              <button
                className={styles.removeImage}
                onClick={() => {
                  removeImage(i);
                }}
                type="button"
              >
                &times;
              </button>
              <textarea
                className={styles.altTextInput}
                value={imageAlts[i] || ''}
                onChange={(e) => {
                  setImageAlt(i, e.target.value);
                }}
                placeholder={t('composer.imageAltText', 'Describe this image...')}
                rows={1}
              />
            </div>
          ))}
        </div>
      )}

      {gif && (
        <div className={styles.gifPreview}>
          {/* eslint-disable-next-line no-restricted-syntax -- URL from server-proxied GIF API */}
          <img src={gif.previewUrl} alt={gif.title} />
          <button
            className={styles.removeImage}
            onClick={() => {
              setGif(null);
              setGifAlt('');
            }}
            type="button"
          >
            &times;
          </button>
          <textarea
            className={styles.altTextInput}
            value={gifAlt}
            onChange={(e) => {
              setGifAlt(e.target.value);
            }}
            placeholder={t('composer.gifAltText', 'Describe this GIF...')}
            rows={1}
          />
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <div className={styles.attachButtons}>
          <button
            className={styles.attachButton}
            onClick={() => {
              fileInputRef.current?.click();
            }}
            type="button"
            disabled={images.length >= 4 || gif !== null}
          >
            {t('composer.attachImage')}
          </button>
          {hasAnyGifService && (
            <button
              className={styles.attachButton}
              onClick={() => {
                setShowGifModal(true);
              }}
              type="button"
              disabled={images.length > 0 || gif !== null}
            >
              GIF
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageSelect}
        />
        <div className={styles.actionRight}>
          <button
            className={styles.cancelButton}
            onClick={() => {
              clear();
              setExpanded(false);
              onClearReply?.();
              onClearQuote?.();
            }}
            type="button"
          >
            {t('composer.cancel')}
          </button>
          <button
            className={styles.postButton}
            onClick={() => {
              void handleSubmit();
            }}
            type="button"
            disabled={!canPost}
          >
            {posting ? t('composer.posting') : t('composer.post')}
          </button>
        </div>
      </div>
      {showGifModal && (
        <GifSearchModal
          initialQuery=""
          capabilities={capabilities}
          onClose={() => {
            setShowGifModal(false);
          }}
          onSelect={(selected, altTextFromModal) => {
            setGif(selected);
            setGifAlt(altTextFromModal);
            setShowGifModal(false);
          }}
        />
      )}
    </div>
  );
}
