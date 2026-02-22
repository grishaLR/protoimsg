/**
 * StatusIndicator — thin wrapper around @protoimsg/ui StatusDot.
 *
 * The web app's MemberPresence / MemberWithPresence types use `status: string`
 * rather than the narrower `PresenceStatus` union. This adapter accepts `string`
 * and casts to `PresenceStatus` so web consumers don't need a type-level change,
 * while the actual rendering is delegated to the design-system component.
 *
 * If the web types are ever narrowed to PresenceStatus, this file can be deleted
 * and imports switched directly to `@protoimsg/ui/StatusDot`.
 */
import { StatusDot } from '@protoimsg/ui/StatusDot';
import type { PresenceStatus } from '@protoimsg/shared';

interface StatusIndicatorProps {
  status: string;
  size?: 'sm' | 'md';
}

export function StatusIndicator({ status, size = 'sm' }: StatusIndicatorProps) {
  return <StatusDot status={status as PresenceStatus} size={size} />;
}
