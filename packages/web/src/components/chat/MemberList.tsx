import styles from './MemberList.module.css';

interface MemberListProps {
  members: string[];
}

function truncateDid(did: string): string {
  if (did.length <= 20) return did;
  return did.slice(0, 14) + '...' + did.slice(-4);
}

export function MemberList({ members }: MemberListProps) {
  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Members ({members.length})</h3>
      <ul className={styles.list}>
        {members.map((did) => (
          <li key={did} className={styles.member}>
            {truncateDid(did)}
          </li>
        ))}
      </ul>
    </div>
  );
}
