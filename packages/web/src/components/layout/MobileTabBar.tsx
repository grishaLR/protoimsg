import { useTranslation } from 'react-i18next';
import styles from './MobileTabBar.module.css';

export type MobileTab = 'buddies' | 'rooms' | 'feed';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const TABS: { id: MobileTab; labelKey: 'nav.community' | 'nav.rooms' | 'nav.feed' }[] = [
  { id: 'buddies', labelKey: 'nav.community' },
  { id: 'rooms', labelKey: 'nav.rooms' },
  { id: 'feed', labelKey: 'nav.feed' },
];

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const { t } = useTranslation('common');

  return (
    <nav className={styles.tabBar}>
      {TABS.map((tab) => (
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
