import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';

/**
 * Determine if a requesting user can see the target's real presence status.
 *
 * @param targetVisibility - target user's visibleTo setting
 * @param targetStatus - target user's actual status
 * @param isCloseFriend - whether the requester is in target's close friends
 * @returns the status to show to the requester
 */
export function resolveVisibleStatus(
  targetVisibility: PresenceVisibility,
  targetStatus: PresenceStatus,
  isCloseFriend: boolean,
): PresenceStatus {
  switch (targetVisibility) {
    case 'everyone':
      return targetStatus;
    case 'close-friends':
      return isCloseFriend ? targetStatus : 'offline';
    case 'nobody':
      return 'offline';
  }
}
