import styles from './SystemMessage.module.css';

interface SystemMessageProps {
  text: string;
}

export function SystemMessage({ text }: SystemMessageProps) {
  return (
    <div className={styles.systemMessage} role="status">
      {text}
    </div>
  );
}
