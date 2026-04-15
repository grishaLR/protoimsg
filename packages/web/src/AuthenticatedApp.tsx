import type { ReactNode } from 'react';
import { ModerationProvider } from './contexts/ModerationContext';
import { ProfileProvider } from './contexts/ProfileContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { DmProvider } from './contexts/DmContext';
import { BotDmProvider } from './contexts/BotDmContext';
import { VideoCallProvider } from './contexts/VideoCallContext';
import { GroupCallProvider } from './contexts/GroupCallContext';
import { DmPopoverContainer } from './components/dm/DmPopoverContainer';
import { BotDmPopover } from './components/bot/BotDmPopover';
import { VideoCallOverlay } from './components/videocall/VideoCallOverlay';
import { GroupCallOverlay } from './components/videocall/GroupCallOverlay';
import { BlockProvider } from './contexts/BlockContext';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ActiveVideoProvider } from './contexts/ActiveVideoContext';
import { VideoVolumeProvider } from './contexts/VideoVolumeContext';
import { BOT_ENABLED } from './lib/config';

function MaybeBot({ children }: { children: ReactNode }) {
  return BOT_ENABLED ? <BotDmProvider>{children}</BotDmProvider> : <>{children}</>;
}

/** Wraps authenticated content with providers that require auth */
export function AuthenticatedApp({ children }: { children: ReactNode }) {
  return (
    <ModerationProvider>
      <ProfileProvider>
        <ActiveVideoProvider>
          <VideoVolumeProvider>
            <WebSocketProvider>
              <ConnectionBanner />
              <BlockProvider>
                <DmProvider>
                  <MaybeBot>
                    <VideoCallProvider>
                      <GroupCallProvider>
                        {children}
                        <DmPopoverContainer />
                        {BOT_ENABLED && <BotDmPopover />}
                        <VideoCallOverlay />
                        <GroupCallOverlay />
                      </GroupCallProvider>
                    </VideoCallProvider>
                  </MaybeBot>
                </DmProvider>
              </BlockProvider>
            </WebSocketProvider>
          </VideoVolumeProvider>
        </ActiveVideoProvider>
      </ProfileProvider>
    </ModerationProvider>
  );
}
