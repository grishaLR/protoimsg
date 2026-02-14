import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';

export const STATUS_OPTIONS: Array<{ value: PresenceStatus; labelKey: string }> = [
  { value: 'online', labelKey: 'status.online' },
  { value: 'away', labelKey: 'status.away' },
  { value: 'idle', labelKey: 'status.idle' },
];

export const VISIBILITY_OPTIONS: Array<{ value: PresenceVisibility; labelKey: string }> = [
  { value: 'everyone', labelKey: 'visibility.everyone' },
  { value: 'community', labelKey: 'visibility.community' },
  { value: 'inner-circle', labelKey: 'visibility.innerCircle' },
  { value: 'no-one', labelKey: 'visibility.noOne' },
];
