import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
  ActionSheetIOS,
  Alert,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useBuddyList } from '@/hooks/useBuddyList';
import { usePresence } from '@/hooks/usePresence';
import { useAuth } from '@/services/auth';
import { useWebSocket } from '@/services/WebSocketContext';
import { useProfile, useProfileLookup } from '@/services/ProfileContext';
import { setInnerCircleDids } from '@/services/DmContext';
import { useVideoCall } from '@/services/VideoCallContext';
import { isWebRTCAvailable } from '@/services/datachannel';
import { Avatar } from '@/components/Avatar';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import { ActorSearchInput } from '@/components/ActorSearchInput';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW } from '@/theme';
import { spacing, dotSize, radius, fontSize } from '@/theme/tokens';
import { useGermDeclaration } from '@/hooks/useGermDeclaration';
import { buildGermUrl, type GermMessageMe } from '@/lib/germ';
import type { MemberWithPresence, DoorEvent } from '@/types';
import type { CommunityGroup } from '@protoimsg/lexicon';

const PUBLIC_API = 'https://public.api.bsky.app/xrpc';

const VISIBILITY_I18N_KEYS: Record<string, string> = {
  everyone: 'everyone',
  community: 'community',
  'inner-circle': 'innerCircle',
  'no-one': 'noOne',
};

async function tryOpenGerm(
  targetDid: string,
  viewerDid: string,
  msgs: { checkFailed: string; notEnabled: string; openFailed: string },
): Promise<void> {
  try {
    const res = await fetch(
      `${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(targetDid)}`,
    );
    if (!res.ok) {
      Alert.alert('GERM', msgs.checkFailed);
      return;
    }
    const data = (await res.json()) as { associated?: { germ?: GermMessageMe } };
    const germ = data.associated?.germ;
    if (!germ || germ.showButtonTo === 'none' || !germ.messageMeUrl) {
      Alert.alert('GERM', msgs.notEnabled);
      return;
    }
    const url = buildGermUrl(germ.messageMeUrl, targetDid, viewerDid);
    await Linking.openURL(url);
  } catch {
    Alert.alert('GERM', msgs.openFailed);
  }
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  onGerm,
  showCallButton,
  onLongPress,
}: {
  buddy: MemberWithPresence;
  doorEvent?: DoorEvent;
  onCall?: (did: string) => void;
  onGerm?: (url: string) => void;
  showCallButton?: boolean;
  onLongPress?: (buddy: MemberWithPresence) => void;
}) {
  const { t } = useTranslation('chat');
  const { colors } = useTheme();
  const { isAim } = useAimStyle();
  const profile = useProfile(buddy.did);
  const { canMessage: hasGerm, germUrl } = useGermDeclaration(buddy.did);
  const displayName =
    profile?.displayName ??
    profile?.handle ??
    buddy.did.split(':').pop()?.split('.')[0] ??
    buddy.did;

  const flashBg =
    doorEvent === 'join'
      ? 'rgba(34, 197, 94, 0.08)'
      : doorEvent === 'leave'
        ? 'rgba(239, 68, 68, 0.08)'
        : undefined;

  return (
    <Pressable
      style={[styles.buddyRow, flashBg ? { backgroundColor: flashBg } : undefined]}
      onPress={() => {
        router.push(`/dm/${encodeURIComponent(buddy.did)}`);
      }}
      onLongPress={() => onLongPress?.(buddy)}
      accessibilityRole="button"
      accessibilityLabel={t('buddyList.accessibility.messageBuddy', {
        name: displayName,
        status: buddy.status,
      })}
    >
      <View style={styles.avatarWrapper}>
        <Avatar url={profile?.avatarUrl} name={displayName} size="sm" />
        <View style={styles.dotOverlay}>
          <StatusDot status={buddy.status} doorEvent={doorEvent} />
        </View>
      </View>
      <View style={styles.buddyInfo}>
        <View style={styles.nameRow}>
          <Text style={[styles.buddyName, { color: colors.baseContent }]} numberOfLines={1}>
            {displayName}
          </Text>
          {buddy.isInnerCircle ? (
            <Text style={[styles.starBadge, { color: colors.primary }]}>★</Text>
          ) : null}
        </View>
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
      {hasGerm && germUrl ? (
        <Pressable
          style={[
            styles.callIconButton,
            {
              backgroundColor: colors.base200,
              borderRadius: isAim ? 0 : 14,
            },
          ]}
          onPress={(e) => {
            e.stopPropagation();
            onGerm?.(germUrl);
          }}
          accessibilityRole="button"
          accessibilityLabel={`GERM message ${displayName}`}
          hitSlop={8}
        >
          <Text style={[styles.callIconText, { color: colors.secondary }]}>G</Text>
        </Pressable>
      ) : null}
      {showCallButton && buddy.status !== 'offline' ? (
        <Pressable
          style={[
            styles.callIconButton,
            {
              backgroundColor: colors.base200,
              borderRadius: isAim ? 0 : 14,
            },
          ]}
          onPress={(e) => {
            e.stopPropagation();
            onCall?.(buddy.did);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('buddyList.accessibility.callBuddy', { name: displayName })}
          hitSlop={8}
        >
          <Text style={[styles.callIconText, { color: colors.primary }]}>C</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

export default function BuddyListScreen() {
  const { t } = useTranslation(['chat', 'common']);
  const { did: myDid } = useAuth();
  const {
    buddies,
    groups,
    doorEvents,
    loading,
    error,
    innerCircleDids,
    addBuddy,
    removeBuddy,
    toggleInnerCircle,
  } = useBuddyList();
  const { status, visibleTo } = usePresence();
  const { connected } = useWebSocket();
  const { videoCall } = useVideoCall();
  const { colors } = useTheme();
  const { isAim, aimRadius } = useAimStyle();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const webrtcReady = isWebRTCAvailable();
  const getProfile = useProfileLookup();
  const searchRef = useRef<TextInput>(null);

  const buddyDids = useMemo(() => new Set(buddies.map((b) => b.did)), [buddies]);

  const handleAddBuddy = useCallback(
    (actor: { did: string }) => {
      if (buddyDids.has(actor.did) || actor.did === myDid) return;
      void addBuddy(actor.did);
    },
    [addBuddy, buddyDids, myDid],
  );

  const handleCall = useCallback(
    (did: string) => {
      videoCall(did);
      router.push(`/call/${encodeURIComponent(did)}`);
    },
    [videoCall],
  );

  const handleGerm = useCallback((url: string) => {
    void Linking.openURL(url);
  }, []);

  // Sync inner-circle DIDs to DmContext for IP protection decisions
  useEffect(() => {
    setInnerCircleDids(innerCircleDids);
  }, [innerCircleDids]);

  const toggleGroup = useCallback((name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleLongPress = useCallback(
    (buddy: MemberWithPresence) => {
      const isIC = buddy.isInnerCircle;
      const openDmLabel = t('buddyMenu.openDm');
      const germLabel = t('buddyMenu.messageOnGerm');
      const icLabel = isIC ? t('buddyMenu.removeFromInnerCircle') : t('buddyMenu.addToInnerCircle');
      const callLabel = t('buddyMenu.call');
      const removeLabel = t('buddyMenu.remove');
      const cancelLabel = t('common:button.cancel');
      const germMsgs = {
        checkFailed: t('buddyList.germ.checkFailed'),
        notEnabled: t('buddyList.germ.notEnabled'),
        openFailed: t('buddyList.germ.openFailed'),
      };

      const options = [
        openDmLabel,
        germLabel,
        icLabel,
        buddy.status !== 'offline' && webrtcReady ? callLabel : null,
        removeLabel,
        cancelLabel,
      ].filter((o): o is string => o !== null);

      const cancelIndex = options.indexOf(cancelLabel);
      const destructiveIndex = options.indexOf(removeLabel);

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex },
          (index) => {
            const selected = options[index];
            if (selected === openDmLabel) router.push(`/dm/${encodeURIComponent(buddy.did)}`);
            else if (selected === germLabel && myDid) void tryOpenGerm(buddy.did, myDid, germMsgs);
            else if (selected === icLabel) void toggleInnerCircle(buddy.did);
            else if (selected === callLabel) handleCall(buddy.did);
            else if (selected === removeLabel) {
              Alert.alert(removeLabel, t('buddyList.removeBuddyConfirm'), [
                { text: cancelLabel, style: 'cancel' },
                {
                  text: removeLabel,
                  style: 'destructive',
                  onPress: () => void removeBuddy(buddy.did),
                },
              ]);
            }
          },
        );
      } else {
        Alert.alert(t('buddyMenu.button.title'), undefined, [
          {
            text: openDmLabel,
            onPress: () => {
              router.push(`/dm/${encodeURIComponent(buddy.did)}`);
            },
          },
          { text: germLabel, onPress: () => myDid && void tryOpenGerm(buddy.did, myDid, germMsgs) },
          {
            text: icLabel,
            onPress: () => void toggleInnerCircle(buddy.did),
          },
          ...(buddy.status !== 'offline' && webrtcReady
            ? [
                {
                  text: callLabel,
                  onPress: () => {
                    handleCall(buddy.did);
                  },
                },
              ]
            : []),
          {
            text: removeLabel,
            style: 'destructive' as const,
            onPress: () => void removeBuddy(buddy.did),
          },
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [handleCall, removeBuddy, toggleInnerCircle, webrtcReady, t, myDid],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // The buddy list re-loads automatically on WebSocket reconnect.
    // This is a visual affordance — the loading state clears on next render.
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  }, []);

  const query = searchQuery.toLowerCase().trim();

  const sections = useMemo(
    () =>
      groups
        .map((group: CommunityGroup) => {
          let groupBuddies = group.members
            .map((m) => buddies.find((b) => b.did === m.did))
            .filter((b): b is MemberWithPresence => b != null)
            .sort((a, b) => {
              const order = (s: string) => (s === 'online' ? 0 : s === 'offline' ? 2 : 1);
              return order(a.status) - order(b.status);
            });

          const onlineCount = groupBuddies.filter((b) => b.status !== 'offline').length;
          const totalCount = groupBuddies.length;

          // Apply search filter
          if (query) {
            groupBuddies = groupBuddies.filter((b) => {
              const p = getProfile(b.did);
              return (
                b.did.toLowerCase().includes(query) ||
                p?.handle.toLowerCase().includes(query) ||
                p?.displayName?.toLowerCase().includes(query) ||
                b.awayMessage?.toLowerCase().includes(query)
              );
            });
          }

          return {
            title: group.name,
            onlineCount,
            totalCount,
            isInnerCircle: group.isInnerCircle ?? false,
            data: collapsedGroups.has(group.name) ? [] : groupBuddies,
          };
        })
        .filter((s) => s.totalCount > 0 || s.isInnerCircle),
    [groups, buddies, collapsedGroups, query, getProfile],
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: isAim ? AIM_DESKTOP : colors.surface }]}
      >
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.chromeTextMuted }]}>
            {t('buddyList.loadingBuddyList')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalBuddies = buddies.length;
  const totalOnline = buddies.filter((b) => b.status !== 'offline').length;

  const listContent = (
    <>
      <View
        style={[styles.header, { borderBottomColor: isAim ? colors.borderDark : colors.base200 }]}
      >
        <Text style={[styles.title, { color: colors.baseContent }]}>{t('buddyList.title')}</Text>
        <View style={styles.statusRow}>
          <StatusDot status={connected ? status : 'offline'} />
          <Text style={[styles.statusText, { color: colors.chromeTextMuted }]}>
            {connected
              ? t(`common:status.${status}`, { defaultValue: status })
              : t('common:status.disconnected')}
          </Text>
          {visibleTo !== 'everyone' ? (
            <Text
              style={[
                styles.visibilityBadge,
                {
                  color: colors.primary,
                  backgroundColor: colors.base200,
                  borderRadius: isAim ? 0 : radius.sm / 2,
                },
              ]}
            >
              {t(`common:visibility.${VISIBILITY_I18N_KEYS[visibleTo] ?? visibleTo}`, {
                defaultValue: visibleTo,
              })}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.errorBannerBg }]}>
          <Text style={[styles.errorText, { color: colors.errorBannerText }]}>{error.message}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.searchContainer,
          { borderBottomColor: isAim ? colors.borderDark : colors.base200 },
        ]}
      >
        <ActorSearchInput
          onSelect={handleAddBuddy}
          isOptionDisabled={(actor) => buddyDids.has(actor.did) || actor.did === myDid}
          placeholder={t('buddyList.addBuddyPlaceholder')}
          style={styles.addBuddySearch}
        />
        {totalBuddies > 3 ? (
          <View style={isAim ? styles.searchSunkenOuter : undefined}>
            <View style={isAim ? styles.searchSunkenInner : undefined}>
              <TextInput
                ref={searchRef}
                style={[
                  styles.searchInput,
                  {
                    color: colors.baseContent,
                    backgroundColor: colors.surfaceContent,
                    borderRadius: aimRadius ?? radius.sm,
                  },
                ]}
                placeholder={t('buddyList.filterPlaceholder')}
                placeholderTextColor={colors.chromeTextMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
          </View>
        ) : null}
      </View>

      <BeveledView
        variant="sunken"
        style={isAim ? styles.aimListBevel : undefined}
        innerStyle={isAim ? { backgroundColor: colors.surfaceContent } : undefined}
      >
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.did}
          renderItem={({ item }) => (
            <BuddyRow
              buddy={item}
              doorEvent={doorEvents[item.did]}
              onCall={handleCall}
              onGerm={handleGerm}
              showCallButton={webrtcReady}
              onLongPress={handleLongPress}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Pressable
              style={styles.sectionHeader}
              onPress={() => {
                toggleGroup(section.title);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('buddyList.accessibility.groupHeader', {
                group: section.title,
                online: section.onlineCount,
                total: section.totalCount,
              })}
            >
              <Text style={[styles.sectionArrow, { color: colors.chromeTextMuted }]}>
                {collapsedGroups.has(section.title) ? '▸' : '▾'}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              {query ? (
                <>
                  <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.noMatches')}
                  </Text>
                  <Text style={[styles.emptySubtext, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.noMatchesDetail', { query: searchQuery })}
                  </Text>
                </>
              ) : totalBuddies === 0 ? (
                <>
                  <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.addFirstBuddy')}
                  </Text>
                  <Text style={[styles.emptySubtext, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.addFirstBuddyHint')}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.noOneOnline')}
                  </Text>
                  <Text style={[styles.emptySubtext, { color: colors.chromeTextMuted }]}>
                    {t('buddyList.buddyOfflineCount', { count: totalBuddies })}
                  </Text>
                </>
              )}
            </View>
          }
          ListFooterComponent={
            totalBuddies > 0 && !query ? (
              <Text style={[styles.footerText, { color: colors.chromeTextMuted }]}>
                {t('buddyList.onlineCount', { online: totalOnline, total: totalBuddies })}
              </Text>
            ) : null
          }
        />
      </BeveledView>
    </>
  );

  if (isAim) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: AIM_DESKTOP }]}>
        <BeveledView
          variant="raised"
          style={[styles.aimWindowFrame, { backgroundColor: colors.base100 }, AIM_WINDOW_SHADOW]}
          innerStyle={{ backgroundColor: colors.base100 }}
        >
          <AimTitlebar title={`${t('common:appName')} - ${t('buddyList.title')}`} />
          {listContent}
        </BeveledView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      {listContent}
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
    overflow: 'hidden',
    marginStart: spacing[2],
  },
  searchContainer: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    gap: spacing[3],
  },
  addBuddySearch: {
    zIndex: 10,
  },
  searchSunkenOuter: {
    borderWidth: 1,
    borderTopColor: '#808080',
    borderLeftColor: '#808080',
    borderBottomColor: '#fff',
    borderRightColor: '#fff',
  },
  searchSunkenInner: {
    borderWidth: 1,
    borderTopColor: '#0a0a0a',
    borderLeftColor: '#0a0a0a',
    borderBottomColor: '#dfdfdf',
    borderRightColor: '#dfdfdf',
  },
  searchInput: {
    height: 36,
    paddingHorizontal: spacing[5],
    fontSize: fontSize.base,
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
    flexGrow: 1,
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
    paddingStart: spacing[16],
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  buddyName: {
    fontSize: fontSize.lg,
    flexShrink: 1,
  },
  starBadge: {
    fontSize: 14,
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
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  callIconText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
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
  footerText: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: spacing[6],
  },
  // AIM-specific styles
  aimWindowFrame: {
    flex: 1,
    margin: spacing[3],
  },
  aimListBevel: {
    flex: 1,
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
});
