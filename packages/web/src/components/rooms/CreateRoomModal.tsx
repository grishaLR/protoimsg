import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LIMITS } from '@protoimsg/shared';
import type { RoomPurpose, RoomVisibility } from '@protoimsg/shared';
import { createRoomRecord } from '../../lib/atproto';
import { useAuth } from '../../hooks/useAuth';
import styles from './CreateRoomModal.module.css';

interface CreateRoomModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateRoomModal({ onClose, onCreated }: CreateRoomModalProps) {
  const { t } = useTranslation('rooms');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { agent } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [purpose, setPurpose] = useState<RoomPurpose>('discussion');
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    el.showModal();
  }, []);

  const handleClose = useCallback(() => {
    previousActiveRef.current?.focus();
    onClose();
  }, [onClose]);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!agent || !name.trim()) return;

    setSubmitting(true);
    setError(null);

    void createRoomRecord(agent, {
      name: name.trim(),
      description: description.trim() || undefined,
      topic: topic.trim(),
      purpose,
      visibility,
    })
      .then((result) => {
        onCreated();
        void navigate(`/rooms/${result.rkey}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('createRoom.error.default'));
        setSubmitting(false);
      });
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h2 className={styles.title}>{t('createRoom.title')}</h2>

        <label className={styles.label}>
          {t('createRoom.nameLabel')}
          <input
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, LIMITS.maxRoomNameLength));
            }}
            placeholder={t('createRoom.namePlaceholder')}
            required
            autoFocus
          />
        </label>

        <label className={styles.label}>
          {t('createRoom.descriptionLabel')}
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value.slice(0, LIMITS.maxRoomDescriptionLength));
            }}
            placeholder={t('createRoom.descriptionPlaceholder')}
            rows={3}
          />
        </label>

        <label className={styles.label}>
          {t('createRoom.topicLabel')}
          <input
            className={styles.input}
            type="text"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value.slice(0, LIMITS.maxRoomTopicLength));
            }}
            placeholder={t('createRoom.topicPlaceholder')}
          />
        </label>

        <label className={styles.label}>
          {t('createRoom.purposeLabel')}
          <select
            className={styles.select}
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value as RoomPurpose);
            }}
          >
            <option value="discussion">{t('createRoom.purpose.discussion')}</option>
            <option value="event">{t('createRoom.purpose.event')}</option>
            <option value="community">{t('createRoom.purpose.community')}</option>
            <option value="support">{t('createRoom.purpose.support')}</option>
          </select>
        </label>

        <label className={styles.label}>
          {t('createRoom.visibilityLabel')}
          <select
            className={styles.select}
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as RoomVisibility);
            }}
          >
            <option value="public">{t('createRoom.visibility.public')}</option>
            <option value="unlisted">{t('createRoom.visibility.unlisted')}</option>
            <option value="private">{t('createRoom.visibility.private')}</option>
          </select>
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            {t('createRoom.cancel')}
          </button>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={submitting || !name.trim()}
          >
            {submitting ? t('createRoom.submitting') : t('createRoom.submit')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
