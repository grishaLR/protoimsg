import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useVideoCall } from '@/services/VideoCallContext';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme';
import { spacing, fontSize, zIndex } from '@/theme/tokens';

export function IncomingCallBanner() {
  const { t } = useTranslation('chat');
  const { activeCall, acceptCall, rejectCall } = useVideoCall();
  const { colors } = useTheme();
  const recipientDid = activeCall?.status === 'incoming' ? activeCall.recipientDid : null;
  const profile = useProfile(recipientDid);

  // Pulse animation for the ring effect
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeCall?.status === 'incoming') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => {
        animation.stop();
      };
    }
    pulseAnim.setValue(1);
  }, [activeCall?.status, pulseAnim]);

  if (!activeCall || activeCall.status !== 'incoming') return null;

  const displayName =
    profile?.displayName ??
    profile?.handle ??
    activeCall.recipientDid.split(':').pop()?.slice(0, 16) ??
    '';

  const handleAccept = async () => {
    await acceptCall();
    router.push(`/call/${encodeURIComponent(activeCall.recipientDid)}`);
  };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.base100 }]}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Avatar url={profile?.avatarUrl} name={displayName} size="lg" />
        </Animated.View>

        <Text style={[styles.name, { color: colors.baseContent }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.label, { color: colors.chromeTextMuted }]}>
          {t('videoCall.incoming.banner')}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, styles.rejectButton]}
          onPress={rejectCall}
          accessibilityRole="button"
          accessibilityLabel={t('videoCall.incoming.rejectAriaLabel')}
        >
          <Text style={styles.buttonIcon}>X</Text>
          <Text style={styles.buttonLabel}>{t('videoCall.incoming.declineLabel')}</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.acceptButton]}
          onPress={() => void handleAccept()}
          accessibilityRole="button"
          accessibilityLabel={t('videoCall.incoming.acceptAriaLabel')}
        >
          <Text style={styles.buttonIcon}>+</Text>
          <Text style={styles.buttonLabel}>{t('videoCall.incoming.acceptLabel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const BUTTON_SIZE = 64;

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: zIndex.videocall,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    gap: spacing[4],
    marginBottom: spacing[16],
  },
  name: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    marginTop: spacing[4],
  },
  label: {
    fontSize: fontSize.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing[16],
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    backgroundColor: '#22c55e',
  },
  rejectButton: {
    backgroundColor: '#ef4444',
  },
  buttonIcon: {
    color: '#fff',
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  buttonLabel: {
    color: '#fff',
    fontSize: fontSize['2xs'],
    marginTop: spacing[1],
    position: 'absolute',
    bottom: -20,
  },
});
