import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OptionalScopeGroup } from '@protoimsg/shared';
import { FEED_ENABLED } from '../../lib/config';
import styles from './ScopePickerPanel.module.css';

interface ScopePickerPanelProps {
  selectedGroups: OptionalScopeGroup[];
  onToggle: (group: OptionalScopeGroup) => void;
}

const OPTIONAL_GROUPS: {
  key: OptionalScopeGroup;
  labelKey: string;
  descKey: string;
}[] = [
  { key: 'feed', labelKey: 'scopePicker.feed', descKey: 'scopePicker.feedDesc' },
  {
    key: 'profileEdit',
    labelKey: 'scopePicker.profileEdit',
    descKey: 'scopePicker.profileEditDesc',
  },
];

export function ScopePickerPanel({ selectedGroups, onToggle }: ScopePickerPanelProps) {
  const { t } = useTranslation('auth');
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
      >
        <span className={`${styles.arrow} ${open ? styles.arrowOpen : ''}`}>&#9654;</span>
        {t('scopePicker.customize', { defaultValue: 'Customize permissions' })}
      </button>
      {open && (
        <div className={styles.options}>
          {OPTIONAL_GROUPS.filter((g) => g.key !== 'feed' || FEED_ENABLED).map((group) => {
            const isChecked = selectedGroups.includes(group.key);
            return (
              <label key={group.key} className={styles.optionLabel}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    onToggle(group.key);
                  }}
                />
                <span>
                  <span className={styles.optionName}>
                    {t(group.labelKey as 'scopePicker.feed')}
                  </span>
                  <span className={styles.optionDesc}>
                    {t(group.descKey as 'scopePicker.feedDesc')}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
