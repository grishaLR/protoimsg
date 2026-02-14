import { useTranslation } from 'react-i18next';
import { StatusIndicator } from './StatusIndicator';
import { UserIdentity } from './UserIdentity';
import { MemberMenu } from './MemberMenu';
import { useAuth } from '../../hooks/useAuth';
import type { DoorEvent } from '../../hooks/useRoom';
import type { MemberPresence } from '../../types';
import styles from './MemberList.module.css';

interface MemberListProps {
  members: MemberPresence[];
  doorEvents?: Record<string, DoorEvent>;
}

export function MemberList({ members, doorEvents = {} }: MemberListProps) {
  const { t } = useTranslation('chat');
  const { did: myDid } = useAuth();

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>{t('memberList.heading', { count: members.length })}</h3>
      <ul className={styles.list}>
        {members.map((member) => {
          const door = doorEvents[member.did];
          const isSelf = member.did === myDid;
          return (
            <li
              key={member.did}
              className={`${styles.member} ${door === 'leave' ? styles.leaving : ''}`}
            >
              {door ? (
                <span className={styles.doorEmoji}>
                  {door === 'join' ? '\u{1F6AA}\u{2728}' : '\u{1F6AA}\u{1F4A8}'}
                </span>
              ) : (
                <StatusIndicator status={member.status} />
              )}
              <div className={styles.memberInfo}>
                <span className={styles.memberDid}>
                  <UserIdentity did={member.did} showAvatar />
                </span>
                {member.awayMessage && <span className={styles.awayMsg}>{member.awayMessage}</span>}
              </div>
              {!isSelf && <MemberMenu did={member.did} className={styles.menuReveal} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
