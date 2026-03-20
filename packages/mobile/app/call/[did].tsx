/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { useVideoCall } from '@/services/VideoCallContext';
import { getWebRTC } from '@/services/datachannel';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from '@/components/Avatar';
import { MicOff, Mic, VideoOff, Video, SwitchCamera, PhoneOff } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';
import { openAppSettings } from '@/services/permissions';

/** Format seconds as MM:SS */
function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function CallScreen() {
  const { t } = useTranslation('chat');
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

  // Call timer — increments every second while status is 'active'
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (activeCall?.status === 'active') {
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeCall?.status]);

  /** Dismiss the call modal — navigate to buddy list */
  const dismissCall = useCallback(() => {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.replace('/(tabs)/buddy-list');
    }
  }, []);

  /** Hang up and navigate away immediately (don't wait for state update) */
  const handleHangUp = useCallback(() => {
    dismissCall();
    hangUp();
  }, [dismissCall, hangUp]);

  // If call ended remotely (transitions from non-null → null), dismiss.
  const hadCallRef = React.useRef(false);
  useEffect(() => {
    if (activeCall) {
      hadCallRef.current = true;
    } else if (hadCallRef.current) {
      hadCallRef.current = false;
      dismissCall();
    }
  }, [activeCall, dismissCall]);

  const webrtc = getWebRTC();
  const RTCView = webrtc?.RTCView;

  const status = activeCall?.status;
  const remoteStream = activeCall?.remoteStream;
  const localStream = activeCall?.localStream;

  const remoteStreamURL = remoteStream?.toURL() ?? null;
  const localStreamURL = localStream?.toURL() ?? null;

  // Connection state banner text + color
  let bannerText: string | null = null;
  let bannerColor = 'transparent';
  if (status === 'outgoing') {
    bannerText = t('videoCall.calling');
    bannerColor = 'rgba(234,179,8,0.9)';
  } else if (status === 'reconnecting') {
    bannerText = t('videoCall.reconnecting');
    bannerColor = 'rgba(234,179,8,0.9)';
  } else if (status === 'failed') {
    bannerText = t('videoCall.callFailed');
    bannerColor = 'rgba(239,68,68,0.9)';
  }

  return (
    <View style={styles.container}>
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
          {status === 'failed' && (
            <View style={styles.failedContainer}>
              {callError ? <Text style={styles.errorText}>{callError}</Text> : null}
              <Pressable
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={retryCall}
              >
                <Text style={[styles.retryText, { color: colors.primaryContent }]}>
                  {t('videoCall.retry')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.settingsButton, { borderColor: colors.primary }]}
                onPress={openAppSettings}
              >
                <Text style={[styles.settingsText, { color: colors.primary }]}>
                  {t('videoCall.openSettings', { defaultValue: 'Open Settings' })}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Connection state banner */}
      {bannerText && status !== 'failed' && (
        <View style={[styles.stateBanner, { backgroundColor: bannerColor }]}>
          <Text style={styles.stateBannerText}>{bannerText}</Text>
        </View>
      )}

      {/* Call timer — visible when active */}
      {status === 'active' && (
        <View style={styles.timerContainer}>
          <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
        </View>
      )}

      {/* Local video inset */}
      {(status === 'active' || status === 'reconnecting') && (
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
              <Text style={styles.localVideoOffText}>
                {isCameraOff ? t('videoCall.camOff') : ''}
              </Text>
            </View>
          )}
          {/* Mute/camera indicators on local inset */}
          <View style={styles.localIndicators}>
            {isMuted && (
              <View style={styles.indicatorBadge}>
                <Text style={styles.indicatorText}>{t('videoCall.micOff')}</Text>
              </View>
            )}
            {isCameraOff && (
              <View style={styles.indicatorBadge}>
                <Text style={styles.indicatorText}>{t('videoCall.camOff')}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Control bar */}
      {status !== 'failed' && (
        <View style={styles.controlBar}>
          <ControlButton
            label={isMuted ? t('videoCall.unmute') : t('videoCall.mute')}
            icon={isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
            onPress={toggleMute}
            active={isMuted}
          />
          <ControlButton
            label={isCameraOff ? t('videoCall.cameraOn') : t('videoCall.cameraOff')}
            icon={
              isCameraOff ? <VideoOff size={22} color="#fff" /> : <Video size={22} color="#fff" />
            }
            onPress={toggleCamera}
            active={isCameraOff}
          />
          <ControlButton
            label={t('videoCall.flip')}
            icon={<SwitchCamera size={22} color="#fff" />}
            onPress={flipCamera}
            active={false}
          />
          <ControlButton
            label={t('videoCall.hangUp')}
            icon={<PhoneOff size={22} color="#fff" />}
            onPress={handleHangUp}
            active={false}
            destructive
          />
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
  icon: React.ReactNode;
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
      {icon}
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

const CONTROL_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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
  settingsButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing[1],
  },
  settingsText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  stateBanner: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    paddingVertical: spacing[2],
    alignItems: 'center',
  },
  stateBannerText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  timerContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  timerText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.md,
    fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    borderRadius: radius.sm,
    overflow: 'hidden',
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
  localIndicators: {
    position: 'absolute',
    bottom: spacing[1],
    left: spacing[1],
    gap: spacing[0.5],
  },
  indicatorBadge: {
    backgroundColor: 'rgba(239,68,68,0.8)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing[1],
    paddingVertical: 1,
  },
  indicatorText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
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
