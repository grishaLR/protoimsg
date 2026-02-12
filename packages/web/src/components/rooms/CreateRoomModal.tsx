import { useRef, useEffect, useState, useCallback } from 'react';
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
        setError(err instanceof Error ? err.message : 'Failed to create room');
        setSubmitting(false);
      });
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h2 className={styles.title}>Create Room</h2>

        <label className={styles.label}>
          Name
          <input
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, LIMITS.maxRoomNameLength));
            }}
            placeholder="Room name"
            required
            autoFocus
          />
        </label>

        <label className={styles.label}>
          Description
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value.slice(0, LIMITS.maxRoomDescriptionLength));
            }}
            placeholder="What's this room about?"
            rows={3}
          />
        </label>

        <label className={styles.label}>
          Topic
          <input
            className={styles.input}
            type="text"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value.slice(0, LIMITS.maxRoomTopicLength));
            }}
            placeholder="Current topic of discussion"
          />
        </label>

        <label className={styles.label}>
          Purpose
          <select
            className={styles.select}
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value as RoomPurpose);
            }}
          >
            <option value="discussion">Discussion</option>
            <option value="event">Event</option>
            <option value="community">Community</option>
            <option value="support">Support</option>
          </select>
        </label>

        <label className={styles.label}>
          Visibility
          <select
            className={styles.select}
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as RoomVisibility);
            }}
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
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
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={submitting || !name.trim()}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
