import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react-native';
import { ActorSearchInput } from '@/components/ActorSearchInput';
import { Avatar } from '@/components/Avatar';
import { publicAgent } from '@/lib/public-agent';
import type { ActorSearchResult } from '@/lib/search-actors';
import { useTheme } from '@/theme';
import { spacing, fontSize } from '@/theme/tokens';

interface SuggestedUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
}

export default function SearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch suggested follows
  const { data: suggestions } = useQuery({
    queryKey: ['suggested-follows'],
    queryFn: async () => {
      const res = await publicAgent.app.bsky.actor.getSuggestions({ limit: 20 });
      return res.data.actors.map(
        (a): SuggestedUser => ({
          did: a.did,
          handle: a.handle,
          displayName: a.displayName,
          avatar: a.avatar,
          description: a.description,
        }),
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleSelect = useCallback(
    (actor: ActorSearchResult) => {
      setHasSearched(true);
      router.push(`/profile/${encodeURIComponent(actor.did)}` as never);
    },
    [router],
  );

  const renderSuggestion = useCallback(
    ({ item }: ListRenderItemInfo<SuggestedUser>) => (
      <Pressable
        style={[styles.suggestionRow, { borderBottomColor: colors.base200 }]}
        onPress={() => {
          router.push(`/profile/${encodeURIComponent(item.did)}` as never);
        }}
      >
        <Avatar url={item.avatar} name={item.displayName ?? item.handle} size="sm" />
        <View style={styles.suggestionInfo}>
          <Text style={[styles.suggestionName, { color: colors.baseContent }]} numberOfLines={1}>
            {item.displayName ?? item.handle}
          </Text>
          <Text
            style={[styles.suggestionHandle, { color: colors.chromeTextMuted }]}
            numberOfLines={1}
          >
            @{item.handle}
          </Text>
          {item.description ? (
            <Text
              style={[styles.suggestionDesc, { color: colors.chromeTextMuted }]}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    ),
    [colors, router],
  );

  const keyExtractor = useCallback((item: SuggestedUser) => item.did, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Search input */}
      <View style={[styles.searchHeader, { borderBottomColor: colors.base200 }]}>
        <ActorSearchInput
          onSelect={handleSelect}
          placeholder="Search people..."
          style={styles.searchInput}
        />
      </View>

      {/* Suggestions */}
      {!hasSearched && suggestions && suggestions.length > 0 ? (
        <>
          <View style={styles.sectionHeader}>
            <TrendingUp size={16} color={colors.chromeTextMuted} />
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              Suggested for you
            </Text>
          </View>
          <FlatList
            data={suggestions}
            renderItem={renderSuggestion}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.list}
          />
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    zIndex: 10,
  },
  searchInput: {
    zIndex: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: {
    paddingBottom: spacing[12],
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  suggestionInfo: {
    flex: 1,
    gap: spacing[1],
  },
  suggestionName: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  suggestionHandle: {
    fontSize: fontSize.sm,
  },
  suggestionDesc: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.4,
    marginTop: spacing[1],
  },
});
