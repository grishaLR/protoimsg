/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useVideoCall } from '@/services/VideoCallContext';
import { getWebRTC } from '@/services/datachannel';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

export default function CallScreen() {
  const { did: recipientDid } = useLocalSearchParams<{ did: string }>();
  const {
    activeCall,
    callError,
    isMuted,
    isCameraOff,
    hangUp,
    retryCall,
    toggleMute,
    toggleCamera,
    flipCamera,
  } = useVideoCall();
  const profile = useProfile(recipientDid);
  const { colors } = useTheme();

  const displayName =
    profile?.displayName ?? profile?.handle ?? recipientDid.split(':').pop()?.slice(0, 16) ?? '';

  // If call ended (transitions from non-null → null), go back.
  // Use a ref to track whether we ever had a call, so we don't
  // navigate away on initial mount before call_ready arrives.
  const hadCallRef = React.useRef(false);
  useEffect(() => {
    if (activeCall) {
      hadCallRef.current = true;
    } else if (hadCallRef.current) {
      router.back();
    }
  }, [activeCall]);

  const webrtc = getWebRTC();
  const RTCView = webrtc?.RTCView;

  const status = activeCall?.status;
  const remoteStream = activeCall?.remoteStream;
  const localStream = activeCall?.localStream;

  const remoteStreamURL = remoteStream?.toURL() ?? null;
  const localStreamURL = localStream?.toURL() ?? null;

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Remote video or placeholder */}
      {RTCView && remoteStreamURL && status === 'active' ? (
        <RTCView
          streamURL={remoteStreamURL}
          style={styles.remoteVideo as ViewStyle}
          objectFit="cover"
          zOrder={0}
        />
      ) : (
        <View style={styles.remotePlaceholder}>
          <Avatar url={profile?.avatarUrl} name={displayName} size="lg" />
          <Text style={styles.remoteDisplayName}>{displayName}</Text>
          {status === 'outgoing' && <Text style={styles.statusLabel}>Calling...</Text>}
          {status === 'reconnecting' && <Text style={styles.statusLabel}>Reconnecting...</Text>}
          {status === 'failed' && (
            <View style={styles.failedContainer}>
              <Text style={styles.statusLabel}>Call Failed</Text>
              {callError ? <Text style={styles.errorText}>{callError}</Text> : null}
              <Pressable
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={retryCall}
              >
                <Text style={[styles.retryText, { color: colors.primaryContent }]}>Retry</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Local video inset — always show during active/reconnecting call */}
      {status === 'active' || status === 'reconnecting' ? (
        <View style={styles.localVideoContainer}>
          {RTCView && localStreamURL && !isCameraOff ? (
            <RTCView
              streamURL={localStreamURL}
              style={styles.localVideo as ViewStyle}
              objectFit="cover"
              mirror={true}
              zOrder={1}
            />
          ) : (
            <View style={styles.localVideoOff}>
              <Text style={styles.localVideoOffText}>{isCameraOff ? 'CAM OFF' : ''}</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Control bar */}
      {status !== 'failed' && (
        <View style={styles.controlBar}>
          <ControlButton
            label={isMuted ? 'Unmute' : 'Mute'}
            icon={isMuted ? 'M' : 'U'}
            onPress={toggleMute}
            active={isMuted}
          />
          <ControlButton
            label={isCameraOff ? 'Camera On' : 'Camera Off'}
            icon={isCameraOff ? 'C' : 'V'}
            onPress={toggleCamera}
            active={isCameraOff}
          />
          <ControlButton label="Flip" icon="F" onPress={flipCamera} active={false} />
          <ControlButton label="Hang Up" icon="X" onPress={hangUp} active={false} destructive />
        </View>
      )}
    </View>
  );
}

function ControlButton({
  label,
  icon,
  onPress,
  active,
  destructive,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  active: boolean;
  destructive?: boolean;
}) {
  const bg = destructive ? '#ef4444' : active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)';
  return (
    <Pressable
      style={[styles.controlButton, { backgroundColor: bg }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.controlIcon}>{icon}</Text>
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

const CONTROL_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  remoteVideo: {
    flex: 1,
  },
  remotePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
  },
  remoteDisplayName: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: '600',
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.md,
  },
  failedContainer: {
    alignItems: 'center',
    gap: spacing[3],
  },
  errorText: {
    color: 'rgba(255,200,200,0.9)',
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing[8],
  },
  retryButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    marginTop: spacing[2],
  },
  retryText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  localVideoContainer: {
    position: 'absolute',
    bottom: 120,
    right: spacing[4],
    width: 100,
    height: 140,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: '#111',
  },
  localVideo: {
    flex: 1,
  },
  localVideoOff: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localVideoOffText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: fontSize['2xs'],
  },
  controlBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[5],
    paddingHorizontal: spacing[6],
  },
  controlButton: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: {
    color: '#fff',
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  controlLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize['2xs'],
    marginTop: 2,
  },
});
