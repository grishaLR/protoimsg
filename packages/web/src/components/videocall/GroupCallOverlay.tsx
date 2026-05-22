import '@livekit/components-styles';
import { LiveKitRoom } from '@livekit/components-react';
import { useGroupCall } from '../../contexts/GroupCallContext';
import { GroupCallInner } from './groupcall/GroupCallInner';
import { ROOM_OPTIONS } from './groupcall/types';

/**
 * Entry point for the group video call. Connects the LiveKit room and renders
 * the call UI. The UI itself lives in ./groupcall/* as a memoized component
 * tree so chat/emoji churn doesn't re-render the video grid.
 */
export function GroupCallOverlay() {
  const { activeGroupCall, leaveGroupCall } = useGroupCall();

  if (!activeGroupCall) return null;

  const { token, url, meetCode } = activeGroupCall;

  return (
    <>
      {/* CSS for floating emoji animation */}
      <style>{`
        @keyframes groupCallEmojiFloat {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-300px) scale(1.5); opacity: 0; }
        }
      `}</style>
      <LiveKitRoom
        token={token}
        serverUrl={url}
        options={ROOM_OPTIONS}
        connect={true}
        audio={false}
        video={false}
        onDisconnected={() => {
          leaveGroupCall();
        }}
      >
        <GroupCallInner onLeave={leaveGroupCall} meetCode={meetCode} />
      </LiveKitRoom>
    </>
  );
}
