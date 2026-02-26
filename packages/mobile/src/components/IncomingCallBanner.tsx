import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useVideoCall } from '@/services/VideoCallContext';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius, zIndex } from '@/theme/tokens';

export function IncomingCallBanner() {
  const { activeCall, acceptCall, rejectCall } = useVideoCall();
  const { colors } = useTheme();
  const recipientDid = activeCall?.status === 'incoming' ? activeCall.recipientDid : null;
  const profile = useProfile(recipientDid);

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
    <View
      style={[
        styles.container,
        { backgroundColor: colors.base200, borderColor: colors.borderLight },
      ]}
    >
      <Avatar url={profile?.avatarUrl} name={displayName} size="sm" />
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.baseContent }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.label, { color: colors.chromeTextMuted }]}>Incoming video call</Text>
      </View>
      <Pressable
        style={[styles.button, styles.acceptButton]}
        onPress={() => void handleAccept()}
        accessibilityRole="button"
        accessibilityLabel="Accept call"
      >
        <Text style={styles.buttonIcon}>+</Text>
      </Pressable>
      <Pressable
        style={[styles.button, styles.rejectButton]}
        onPress={rejectCall}
        accessibilityRole="button"
        accessibilityLabel="Reject call"
      >
        <Text style={styles.buttonIcon}>x</Text>
      </Pressable>
    </View>
  );
}

const BUTTON_SIZE = 44;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: spacing[4],
    right: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    zIndex: zIndex.banner,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    gap: spacing[3],
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  label: {
    fontSize: fontSize.xs,
    marginTop: spacing[0.5],
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
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
});
