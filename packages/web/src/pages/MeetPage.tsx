import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video, Keyboard } from 'lucide-react';
import { useGroupCall } from '../contexts/GroupCallContext';
import styles from './MeetPage.module.css';

/** Standalone Meet landing content — used as a tab in RoomDirectoryPage. */
type AccessOption = 'anyone' | 'community' | 'inner-circle';

export function MeetLanding() {
  const { t } = useTranslation('common');
  const { startStandaloneMeeting, joinByCode } = useGroupCall();
  const [code, setCode] = useState('');
  const [access, setAccess] = useState<AccessOption>('anyone');

  const handleNewMeeting = useCallback(() => {
    startStandaloneMeeting(access);
  }, [startStandaloneMeeting, access]);

  const handleJoinByCode = useCallback(() => {
    const trimmed = code.trim();
    if (!trimmed) return;
    joinByCode(trimmed);
  }, [code, joinByCode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleJoinByCode();
      }
    },
    [handleJoinByCode],
  );

  return (
    <div className={styles.center}>
      <h1 className={styles.title}>{t('meet.title', 'Video calls for everyone')}</h1>
      <p className={styles.subtitle}>
        {t('meet.subtitle', 'Free, cross-platform video calls. No platform walls.')}
      </p>

      <div className={styles.actions}>
        <div className={styles.accessPicker}>
          <label className={styles.accessLabel}>{t('meet.whoCanJoin', 'Who can join')}</label>
          <select
            className={styles.accessSelect}
            value={access}
            onChange={(e) => {
              setAccess(e.target.value as AccessOption);
            }}
          >
            <option value="anyone">{t('meet.access.anyone', 'Anyone with the link')}</option>
            <option value="community">{t('meet.access.community', 'My community only')}</option>
            <option value="inner-circle">
              {t('meet.access.innerCircle', 'Inner circle only')}
            </option>
          </select>
        </div>

        <button
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          onClick={handleNewMeeting}
        >
          <Video size={18} style={{ verticalAlign: 'middle' }} />
          {t('meet.newMeeting', 'New meeting')}
        </button>

        <div className={styles.joinGroup}>
          <div className={styles.codeInput}>
            <Keyboard size={18} className={styles.codeIcon} />
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder={t('meet.enterCode', 'Enter a code or link')}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button className="btn btn-ghost" onClick={handleJoinByCode} disabled={!code.trim()}>
            {t('meet.join', 'Join')}
          </button>
        </div>
      </div>
    </div>
  );
}
