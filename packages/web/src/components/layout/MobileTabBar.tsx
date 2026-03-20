import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { FEED_ENABLED, CHAT_ROOMS_ENABLED } from '../../lib/config';
import styles from './MobileTabBar.module.css';

export type MobileTab = 'meet' | 'buddies' | 'rooms' | 'feed';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const ALL_TABS: {
  id: MobileTab;
  labelKey: 'nav.meet' | 'nav.community' | 'nav.rooms' | 'nav.feed';
}[] = [
  { id: 'meet', labelKey: 'nav.meet' },
  { id: 'buddies', labelKey: 'nav.community' },
  { id: 'rooms', labelKey: 'nav.rooms' },
  { id: 'feed', labelKey: 'nav.feed' },
];

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const { t } = useTranslation('common');
  const { hasFeed } = useAuth();

  const tabs = useMemo(
    () =>
      ALL_TABS.filter((tab) => {
        if (tab.id === 'feed' && (!FEED_ENABLED || !hasFeed)) return false;
        if (tab.id === 'rooms' && !CHAT_ROOMS_ENABLED) return false;
        return true;
      }),
    [hasFeed],
  );

  return (
    <nav className={styles.tabBar}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
          onClick={() => {
            onTabChange(tab.id);
          }}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </nav>
  );
}
