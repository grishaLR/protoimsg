import type { FeedInfo } from '../../types';
import styles from './FeedTabBar.module.css';

interface FeedTabBarProps {
  feeds: FeedInfo[];
  activeUri: string | undefined;
  onSelect: (uri: string | undefined) => void;
}

export function FeedTabBar({ feeds, activeUri, onSelect }: FeedTabBarProps) {
  return (
    <div className={styles.tabBar}>
      {feeds.map((feed) => {
        const isActive =
          feed.uri === activeUri || (feed.uri === undefined && activeUri === undefined);
        return (
          <button
            key={feed.uri ?? '__following__'}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => {
              onSelect(feed.uri);
            }}
          >
            {feed.displayName}
          </button>
        );
      })}
    </div>
  );
}
