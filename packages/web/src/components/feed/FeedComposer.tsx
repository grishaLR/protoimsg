import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useCompose } from '../../hooks/useCompose';
import styles from './FeedComposer.module.css';

interface FeedComposerProps {
  replyTo: AppBskyFeedDefs.PostView | null;
  onClearReply?: () => void;
  onPostSuccess?: () => void;
}

export function FeedComposer({ replyTo, onClearReply, onPostSuccess }: FeedComposerProps) {
  const { t } = useTranslation('feed');
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    text,
    setText,
    images,
    addImage,
    removeImage,
    setReplyTo,
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

  const handleClearReply = useCallback(() => {
    setReplyTo(null);
    onClearReply?.();
  }, [setReplyTo, onClearReply]);

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
            </div>
          ))}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.attachButton}
          onClick={() => {
            fileInputRef.current?.click();
          }}
          type="button"
          disabled={images.length >= 4}
        >
          {t('composer.attachImage')}
        </button>
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
    </div>
  );
}
