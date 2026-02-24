import type { ReactNode } from 'react';
import { ModerationProvider } from './contexts/ModerationContext';
import { ProfileProvider } from './contexts/ProfileContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { DmProvider } from './contexts/DmContext';
import { VideoCallProvider } from './contexts/VideoCallContext';
import { MentionNotificationProvider } from './contexts/MentionNotificationContext';
import { TranslationProvider } from './contexts/TranslationContext';
import { DmPopoverContainer } from './components/dm/DmPopoverContainer';
import { VideoCallOverlay } from './components/videocall/VideoCallOverlay';
import { MentionToastContainer } from './components/mentions/MentionToastContainer';
import { BlockProvider } from './contexts/BlockContext';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ActiveVideoProvider } from './contexts/ActiveVideoContext';
import { VideoVolumeProvider } from './contexts/VideoVolumeContext';

/** Wraps authenticated content with providers that require auth */
export function AuthenticatedApp({ children }: { children: ReactNode }) {
  return (
    <ModerationProvider>
      <ProfileProvider>
        <ActiveVideoProvider>
          <VideoVolumeProvider>
            <TranslationProvider>
              <WebSocketProvider>
                <ConnectionBanner />
                <BlockProvider>
                  <DmProvider>
                    <VideoCallProvider>
                      <MentionNotificationProvider>
                        {children}
                        <DmPopoverContainer />
                        <VideoCallOverlay />
                        <MentionToastContainer />
                      </MentionNotificationProvider>
                    </VideoCallProvider>
                  </DmProvider>
                </BlockProvider>
              </WebSocketProvider>
            </TranslationProvider>
          </VideoVolumeProvider>
        </ActiveVideoProvider>
      </ProfileProvider>
    </ModerationProvider>
  );
}
