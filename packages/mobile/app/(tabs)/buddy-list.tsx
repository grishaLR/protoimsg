import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { View, Text, SectionList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useBuddyList } from '@/hooks/useBuddyList';
import { usePresence } from '@/hooks/usePresence';
import { useWebSocket } from '@/services/WebSocketContext';
import { useProfile } from '@/services/ProfileContext';
import { setInnerCircleDids } from '@/services/DmContext';
import { useVideoCall } from '@/services/VideoCallContext';
import { isWebRTCAvailable } from '@/services/datachannel';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme';
import { spacing, dotSize, radius, fontSize } from '@/theme/tokens';
import type { MemberWithPresence, DoorEvent } from '@/types';
import type { CommunityGroup } from '@protoimsg/lexicon';

function StatusDot({ status, doorEvent }: { status: string; doorEvent?: DoorEvent }) {
  const { colors } = useTheme();
  let color = colors.statusOffline;
  if (doorEvent === 'join') color = colors.success;
  else if (doorEvent === 'leave') color = colors.error;
  else if (status === 'online') color = colors.success;
  else if (status === 'away' || status === 'idle') color = colors.warning;

  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const BuddyRow = React.memo(function BuddyRow({
  buddy,
  doorEvent,
  onCall,
  showCallButton,
}: {
  buddy: MemberWithPresence;
  doorEvent?: DoorEvent;
  onCall?: (did: string) => void;
  showCallButton?: boolean;
}) {
  const { colors } = useTheme();
  const profile = useProfile(buddy.did);
  const displayName =
    profile?.displayName ??
    profile?.handle ??
    buddy.did.split(':').pop()?.split('.')[0] ??
    buddy.did;

  return (
    <Pressable
      style={styles.buddyRow}
      onPress={() => {
        router.push(`/dm/${encodeURIComponent(buddy.did)}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Message ${displayName}, ${buddy.status}`}
    >
      <View style={styles.avatarWrapper}>
        <Avatar url={profile?.avatarUrl} name={displayName} size="sm" />
        <View style={styles.dotOverlay}>
          <StatusDot status={buddy.status} doorEvent={doorEvent} />
        </View>
      </View>
      <View style={styles.buddyInfo}>
        <Text style={[styles.buddyName, { color: colors.baseContent }]} numberOfLines={1}>
          {displayName}
        </Text>
        {profile?.handle ? (
          <Text style={[styles.buddyHandle, { color: colors.chromeTextMuted }]} numberOfLines={1}>
            @{profile.handle}
          </Text>
        ) : null}
        {buddy.awayMessage ? (
          <Text style={[styles.awayMessage, { color: colors.chromeTextMuted }]} numberOfLines={1}>
            {buddy.awayMessage}
          </Text>
        ) : null}
      </View>
      {showCallButton && buddy.status !== 'offline' ? (
        <Pressable
          style={[styles.callIconButton, { backgroundColor: colors.base200 }]}
          onPress={(e) => {
            e.stopPropagation();
            onCall?.(buddy.did);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Call ${displayName}`}
          hitSlop={8}
        >
          <Text style={[styles.callIconText, { color: colors.primary }]}>C</Text>
        </Pressable>
      ) : null}
      {buddy.isInnerCircle ? (
        <Text
          style={[
            styles.innerCircleBadge,
            { color: colors.primary, backgroundColor: colors.base200 },
          ]}
        >
          IC
        </Text>
      ) : null}
    </Pressable>
  );
});

export default function BuddyListScreen() {
  const { buddies, groups, doorEvents, loading, error, innerCircleDids } = useBuddyList();
  const { status, visibleTo } = usePresence();
  const { connected } = useWebSocket();
  const { videoCall } = useVideoCall();
  const { colors } = useTheme();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const webrtcReady = isWebRTCAvailable();

  const handleCall = useCallback(
    (did: string) => {
      videoCall(did);
      router.push(`/call/${encodeURIComponent(did)}`);
    },
    [videoCall],
  );

  // Sync inner-circle DIDs to DmContext for IP protection decisions
  useEffect(() => {
    setInnerCircleDids(innerCircleDids);
  }, [innerCircleDids]);

  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const sections = useMemo(
    () =>
      groups
        .map((group: CommunityGroup) => {
          const groupBuddies = group.members
            .map((m) => buddies.find((b) => b.did === m.did))
            .filter((b): b is MemberWithPresence => b != null)
            .sort((a, b) => {
              const order = (s: string) => (s === 'online' ? 0 : s === 'offline' ? 2 : 1);
              return order(a.status) - order(b.status);
            });

          const onlineCount = groupBuddies.filter((b) => b.status !== 'offline').length;

          return {
            title: group.name,
            onlineCount,
            totalCount: groupBuddies.length,
            isInnerCircle: group.isInnerCircle ?? false,
            data: collapsedGroups.has(group.name) ? [] : groupBuddies,
          };
        })
        .filter((s) => s.totalCount > 0 || s.isInnerCircle),
    [groups, buddies, collapsedGroups],
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.chromeTextMuted }]}>
            Loading buddy list...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
        <Text style={[styles.title, { color: colors.baseContent }]}>Buddy List</Text>
        <View style={styles.statusRow}>
          <StatusDot status={connected ? status : 'offline'} />
          <Text style={[styles.statusText, { color: colors.chromeTextMuted }]}>
            {connected ? status : 'disconnected'}
          </Text>
          {visibleTo !== 'everyone' ? (
            <Text
              style={[
                styles.visibilityBadge,
                { color: colors.primary, backgroundColor: colors.base200 },
              ]}
            >
              {visibleTo}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.errorBannerBg }]}>
          <Text style={[styles.errorText, { color: colors.errorBannerText }]}>{error.message}</Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.did}
        renderItem={({ item }) => (
          <BuddyRow
            buddy={item}
            doorEvent={doorEvents[item.did]}
            onCall={handleCall}
            showCallButton={webrtcReady}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Pressable
            style={styles.sectionHeader}
            onPress={() => {
              toggleGroup(section.title);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${section.title} group, ${section.onlineCount} of ${section.totalCount} online`}
          >
            <Text style={[styles.sectionArrow, { color: colors.chromeTextMuted }]}>
              {collapsedGroups.has(section.title) ? '>' : 'v'}
            </Text>
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionCount, { color: colors.chromeTextMuted }]}>
              ({section.onlineCount}/{section.totalCount})
            </Text>
          </Pressable>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
              No buddies yet
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.chromeTextMuted }]}>
              Add friends from chat rooms or by handle
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[12],
  },
  header: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[2],
  },
  statusText: {
    fontSize: fontSize.base,
  },
  visibilityBadge: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[0.5],
    borderRadius: radius.sm / 2,
    overflow: 'hidden',
    marginLeft: spacing[2],
  },
  loadingText: {
    fontSize: fontSize.lg,
    marginTop: spacing[6],
  },
  errorBanner: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
  errorText: {
    fontSize: fontSize.base,
  },
  listContent: {
    paddingBottom: spacing[12],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[5],
    gap: spacing[3],
  },
  sectionArrow: {
    fontSize: fontSize.sm,
    fontFamily: 'Courier',
    width: 14,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: fontSize.sm,
  },
  buddyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[5],
    paddingLeft: spacing[16],
    gap: spacing[5],
  },
  avatarWrapper: {
    position: 'relative',
  },
  dotOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
  },
  dot: {
    width: dotSize.sm,
    height: dotSize.sm,
    borderRadius: dotSize.sm / 2,
  },
  buddyInfo: {
    flex: 1,
  },
  buddyName: {
    fontSize: fontSize.lg,
  },
  buddyHandle: {
    fontSize: fontSize.xs,
  },
  awayMessage: {
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    marginTop: spacing[0.5],
  },
  callIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  callIconText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  innerCircleBadge: {
    fontSize: fontSize['2xs'],
    fontWeight: '700',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.sm / 3,
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: fontSize.md,
    marginTop: spacing[2],
    textAlign: 'center',
  },
});
