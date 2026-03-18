import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Video, Keyboard } from 'lucide-react';
import { useGroupCall } from '../contexts/GroupCallContext';
import { Header } from '../components/layout/Header';
import styles from './MeetPage.module.css';

export function MeetPage() {
  const { callId } = useParams<{ callId?: string }>();

  // If we have a callId in the URL, auto-join that meeting
  if (callId) {
    return <JoinByCallId callId={callId} />;
  }

  return (
    <div className={styles.page}>
      <Header />
      <MeetLanding />
    </div>
  );
}

function JoinByCallId({ callId }: { callId: string }) {
  const { joinGroupCall } = useGroupCall();
  const [joined, setJoined] = useState(false);

  if (!joined) {
    joinGroupCall(callId);
    setJoined(true);
  }

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.center}>
        <p className={styles.subtitle}>Joining meeting...</p>
      </div>
    </div>
  );
}

/** Standalone Meet landing content — used both in MeetPage and as a tab in RoomDirectoryPage. */
export function MeetLanding() {
  const { t } = useTranslation('rooms');
  const { startStandaloneMeeting, joinByCode } = useGroupCall();
  const [code, setCode] = useState('');

  const handleNewMeeting = useCallback(() => {
    startStandaloneMeeting();
  }, [startStandaloneMeeting]);

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
        <button className="btn btn-primary gap-2" onClick={handleNewMeeting}>
          <Video size={18} />
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
