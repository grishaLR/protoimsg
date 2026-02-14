import type { ReactNode } from 'react';
import { ModerationProvider } from './contexts/ModerationContext';
import { ProfileProvider } from './contexts/ProfileContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { DmProvider } from './contexts/DmContext';
import { MentionNotificationProvider } from './contexts/MentionNotificationContext';
import { TranslationProvider } from './contexts/TranslationContext';
import { DmPopoverContainer } from './components/dm/DmPopoverContainer';
import { MentionToastContainer } from './components/mentions/MentionToastContainer';
import { BlockProvider } from './contexts/BlockContext';
import { ConnectionBanner } from './components/ConnectionBanner';

/** Wraps authenticated content with providers that require auth */
export function AuthenticatedApp({ children }: { children: ReactNode }) {
  return (
    <ModerationProvider>
      <ProfileProvider>
        <TranslationProvider>
          <WebSocketProvider>
            <ConnectionBanner />
            <BlockProvider>
              <DmProvider>
                <MentionNotificationProvider>
                  {children}
                  <DmPopoverContainer />
                  <MentionToastContainer />
                </MentionNotificationProvider>
              </DmProvider>
            </BlockProvider>
          </WebSocketProvider>
        </TranslationProvider>
      </ProfileProvider>
    </ModerationProvider>
  );
}
