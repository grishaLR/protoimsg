import React from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useRooms } from '@/hooks/useRooms';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW } from '@/theme';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { RoomView } from '@/types';

const RoomCard = React.memo(function RoomCard({ room }: { room: RoomView }) {
  const { t } = useTranslation('rooms');
  const { colors } = useTheme();
  const { isAim, aimRadius } = useAimStyle();

  const card = (
    <Pressable
      style={[
        styles.card,
        {
          backgroundColor: isAim ? colors.surfaceContent : colors.base200,
          borderRadius: aimRadius ?? radius.md,
        },
      ]}
      onPress={() => {
        router.push(`/room/${encodeURIComponent(room.id)}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${room.name} chat room${room.category ? `, ${room.category}` : ''}`}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.roomName, { color: colors.baseContent }]} numberOfLines={1}>
          {room.name}
        </Text>
        {room.category ? (
          <Text
            style={[
              styles.categoryBadge,
              {
                color: colors.secondary,
                backgroundColor: colors.surface,
                borderRadius: aimRadius ?? radius.sm / 2,
              },
            ]}
          >
            {room.category}
          </Text>
        ) : null}
      </View>
      {room.topic ? (
        <Text style={[styles.topic, { color: colors.chromeTextMuted }]} numberOfLines={2}>
          {room.topic}
        </Text>
      ) : null}
      {room.description ? (
        <Text style={[styles.description, { color: colors.chromeTextMuted }]} numberOfLines={2}>
          {room.description}
        </Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={[styles.visibility, { color: colors.chromeTextMuted }]}>
          {t(`createRoom.visibility.${room.visibility}`, { defaultValue: room.visibility })}
        </Text>
        {room.slow_mode_seconds > 0 ? (
          <Text style={[styles.slowMode, { color: colors.chromeTextMuted }]}>
            {t('roomCard.slowMode', { seconds: room.slow_mode_seconds })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  if (isAim) {
    return (
      <BeveledView variant="raised" innerStyle={{ backgroundColor: colors.surfaceContent }}>
        {card}
      </BeveledView>
    );
  }

  return card;
});

const keyExtractor = (item: RoomView) => item.id;

export default function ChatScreen() {
  const { t } = useTranslation(['rooms', 'common']);
  const { rooms, loading, error, refresh } = useRooms();
  const { colors } = useTheme();
  const { isAim } = useAimStyle();

  if (loading && rooms.length === 0) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: isAim ? AIM_DESKTOP : colors.surface }]}
      >
        {isAim ? (
          <BeveledView
            variant="raised"
            style={[styles.aimWindowFrame, { backgroundColor: colors.base100 }, AIM_WINDOW_SHADOW]}
            innerStyle={{ backgroundColor: colors.base100 }}
          >
            <AimTitlebar title={`${t('common:appName')} - ${t('directory.title')}`} />
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          </BeveledView>
        ) : (
          <>
            <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
              <Text style={[styles.title, { color: colors.baseContent }]}>
                {t('directory.title')}
              </Text>
            </View>
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          </>
        )}
      </SafeAreaView>
    );
  }

  const listContent = (
    <>
      <View
        style={[styles.header, { borderBottomColor: isAim ? colors.borderDark : colors.base200 }]}
      >
        <Text style={[styles.title, { color: colors.baseContent }]}>{t('directory.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.chromeTextMuted }]}>
          {t('directory.roomCount', { count: rooms.length })}
        </Text>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.errorBannerBg }]}>
          <Text style={[styles.errorText, { color: colors.errorBannerText }]}>{error}</Text>
        </View>
      ) : null}

      <BeveledView
        variant="sunken"
        style={isAim ? styles.aimListBevel : undefined}
        innerStyle={isAim ? { backgroundColor: colors.surfaceContent } : undefined}
      >
        <FlatList
          data={rooms}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => <RoomCard room={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refresh()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                {t('roomList.noRooms')}
              </Text>
            </View>
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
          <AimTitlebar title={`${t('common:appName')} - ${t('directory.title')}`} />
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
  subtitle: {
    fontSize: fontSize.base,
    marginTop: spacing[1],
  },
  errorBanner: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
  errorText: {
    fontSize: fontSize.base,
  },
  listContent: {
    padding: spacing[6],
    gap: spacing[5],
  },
  card: {
    padding: spacing[8],
    gap: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
  },
  roomName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    flex: 1,
  },
  categoryBadge: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    overflow: 'hidden',
  },
  topic: {
    fontSize: fontSize.base,
  },
  description: {
    fontSize: fontSize.base,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: spacing[5],
    marginTop: spacing[1],
  },
  visibility: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slowMode: {
    fontSize: fontSize.xs,
  },
  emptyText: {
    fontSize: fontSize.lg,
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
