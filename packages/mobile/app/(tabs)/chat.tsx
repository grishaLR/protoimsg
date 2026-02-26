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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useRooms } from '@/hooks/useRooms';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { RoomView } from '@/types';

const RoomCard = React.memo(function RoomCard({ room }: { room: RoomView }) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.base200 }]}
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
              { color: colors.secondary, backgroundColor: colors.surface },
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
          {room.visibility}
        </Text>
        {room.slow_mode_seconds > 0 ? (
          <Text style={[styles.slowMode, { color: colors.chromeTextMuted }]}>
            slow: {room.slow_mode_seconds}s
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const keyExtractor = (item: RoomView) => item.id;

export default function ChatScreen() {
  const { rooms, loading, error, refresh } = useRooms();
  const { colors } = useTheme();

  if (loading && rooms.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
          <Text style={[styles.title, { color: colors.baseContent }]}>Chat Rooms</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
        <Text style={[styles.title, { color: colors.baseContent }]}>Chat Rooms</Text>
        <Text style={[styles.subtitle, { color: colors.chromeTextMuted }]}>
          {rooms.length} room{rooms.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.errorBannerBg }]}>
          <Text style={[styles.errorText, { color: colors.errorBannerText }]}>{error}</Text>
        </View>
      ) : null}

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
            <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>No rooms yet</Text>
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
    borderRadius: radius.md,
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
    borderRadius: radius.sm / 2,
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
});
