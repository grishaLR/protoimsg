import '@livekit/components-styles';
import { useEffect, useMemo, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import type { RoomConnectOptions } from 'livekit-client';
import { useGroupCall } from '../../contexts/GroupCallContext';
import { fetchIceServers } from '../../lib/api';
import { GroupCallInner } from './groupcall/GroupCallInner';
import { ROOM_OPTIONS } from './groupcall/types';

/**
 * Entry point for the group video call. Connects the LiveKit room and renders
 * the call UI. The UI itself lives in ./groupcall/* as a memoized component
 * tree so chat/emoji churn doesn't re-render the video grid.
 */
export function GroupCallOverlay() {
  const { activeGroupCall, leaveGroupCall } = useGroupCall();
  const token = activeGroupCall?.token;

  // Our coturn relay, same as 1:1 calls. LiveKit offers no TURN of its own, so
  // without this a network that blocks its media ports (7881–7884) joins the
  // call and never gets audio or video. Fetched per token so credentials are
  // fresh; we hold off connecting until they arrive (or fail → LiveKit only).
  const [ice, setIce] = useState<{ token: string; servers: RTCIceServer[] } | null>(null);
  useEffect(() => {
    if (!token) return;
    const ac = new AbortController();
    void fetchIceServers().then((servers) => {
      if (!ac.signal.aborted) setIce({ token, servers });
    });
    return () => {
      ac.abort();
    };
  }, [token]);

  const iceServers = ice && ice.token === token ? ice.servers : null;
  const connectOptions = useMemo<RoomConnectOptions | undefined>(
    () => (iceServers?.length ? { rtcConfig: { iceServers } } : undefined),
    [iceServers],
  );

  if (!activeGroupCall) return null;

  const { url, meetCode } = activeGroupCall;

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
        connectOptions={connectOptions}
        connect={iceServers !== null}
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
