import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  FlatList,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { searchActorsTypeahead, type ActorSearchResult } from '@/lib/search-actors';
import { useTheme, useAimStyle } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

interface ActorSearchInputProps {
  /** Called when user selects an actor from the dropdown. */
  onSelect: (actor: ActorSearchResult) => void;
  /** Called when text changes (for controlled input). */
  onInputChange?: (text: string) => void;
  /** Controlled value. */
  value?: string;
  /** Clear the input after selection. Default: true */
  clearOnSelect?: boolean;
  /** Check if an actor should be shown as disabled (e.g. already added). */
  isOptionDisabled?: (actor: ActorSearchResult) => boolean;
  /** Extra props forwarded to the underlying TextInput. */
  inputProps?: Omit<TextInputProps, 'value' | 'onChangeText'>;
  placeholder?: string;
  /** Style for the outer wrapper. */
  style?: StyleProp<ViewStyle>;
}

export const ActorSearchInput = React.memo(function ActorSearchInput({
  onSelect,
  onInputChange,
  value,
  clearOnSelect = true,
  isOptionDisabled,
  inputProps,
  placeholder,
  style,
}: ActorSearchInputProps) {
  const { t } = useTranslation('chat');
  const { colors } = useTheme();
  const { isAim } = useAimStyle();
  const resolvedPlaceholder = placeholder ?? t('buddyList.searchPlaceholder');
  const [query, setQuery] = useState(value ?? '');
  const [results, setResults] = useState<ActorSearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, { actors: ActorSearchResult[]; ts: number }>>(new Map());

  // Sync controlled value
  useEffect(() => {
    if (value !== undefined) setQuery(value);
  }, [value]);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toLowerCase();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    // Check cache (30s TTL)
    const cached = cacheRef.current.get(trimmed);
    if (cached && Date.now() - cached.ts < 30_000) {
      setResults(cached.actors);
      setShowDropdown(cached.actors.length > 0);
      return;
    }

    const actors = await searchActorsTypeahead(trimmed);
    cacheRef.current.set(trimmed, { actors, ts: Date.now() });
    setResults(actors);
    setShowDropdown(actors.length > 0);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onInputChange?.(text);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void doSearch(text), DEBOUNCE_MS);
    },
    [onInputChange, doSearch],
  );

  const handleSelect = useCallback(
    (actor: ActorSearchResult) => {
      if (isOptionDisabled?.(actor)) return;
      onSelect(actor);
      setShowDropdown(false);
      if (clearOnSelect) {
        setQuery('');
        onInputChange?.('');
      } else {
        setQuery(actor.handle);
        onInputChange?.(actor.handle);
      }
    },
    [onSelect, clearOnSelect, onInputChange, isOptionDisabled],
  );

  const handleBlur = useCallback(() => {
    // Delay so tap on dropdown item registers before hiding
    setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ActorSearchResult }) => {
      const disabled = isOptionDisabled?.(item) ?? false;
      return (
        <Pressable
          style={[styles.resultRow, disabled && styles.resultRowDisabled]}
          onPress={() => {
            handleSelect(item);
          }}
          disabled={disabled}
        >
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.avatar} />
          ) : (
            <View
              style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.base300 }]}
            >
              <Text style={[styles.avatarFallbackText, { color: colors.chromeTextMuted }]}>
                {(item.displayName ?? item.handle)[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.resultInfo}>
            <Text style={[styles.resultHandle, { color: colors.baseContent }]} numberOfLines={1}>
              @{item.handle}
            </Text>
            {item.displayName ? (
              <Text
                style={[styles.resultName, { color: colors.chromeTextMuted }]}
                numberOfLines={1}
              >
                {item.displayName}
              </Text>
            ) : null}
          </View>
          {disabled ? (
            <Text style={[styles.addedBadge, { color: colors.chromeTextMuted }]}>Added</Text>
          ) : null}
        </Pressable>
      );
    },
    [colors, handleSelect, isOptionDisabled],
  );

  const inputEl = (
    <TextInput
      style={[
        styles.input,
        isAim
          ? {
              backgroundColor: colors.surfaceContent,
              color: colors.baseContent,
              borderWidth: 0,
              borderRadius: 0,
            }
          : {
              backgroundColor: colors.base200,
              color: colors.baseContent,
              borderColor: colors.base300,
            },
      ]}
      placeholder={resolvedPlaceholder}
      placeholderTextColor={colors.chromeTextMuted}
      value={query}
      onChangeText={handleChangeText}
      onBlur={handleBlur}
      autoCapitalize="none"
      autoCorrect={false}
      {...inputProps}
    />
  );

  return (
    <View style={[styles.container, style]}>
      {isAim ? (
        <View style={styles.aimSunkenOuter}>
          <View style={[styles.aimSunkenInner, { backgroundColor: colors.surfaceContent }]}>
            {inputEl}
          </View>
        </View>
      ) : (
        inputEl
      )}
      {showDropdown && results.length > 0 ? (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: colors.surface,
              borderColor: colors.base300,
              borderRadius: isAim ? 0 : radius.md,
            },
          ]}
        >
          <FlatList
            data={results}
            keyExtractor={(item) => item.did}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            style={styles.dropdownList}
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 10,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing[8],
    fontSize: fontSize.lg,
    borderWidth: 1,
  },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    maxHeight: 240,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  dropdownList: {
    maxHeight: 240,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  resultRowDisabled: {
    opacity: 0.5,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  resultInfo: {
    flex: 1,
  },
  resultHandle: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  resultName: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  addedBadge: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  aimSunkenOuter: {
    borderWidth: 1,
    borderTopColor: '#808080',
    borderLeftColor: '#808080',
    borderBottomColor: '#fff',
    borderRightColor: '#fff',
  },
  aimSunkenInner: {
    borderWidth: 1,
    borderTopColor: '#0a0a0a',
    borderLeftColor: '#0a0a0a',
    borderBottomColor: '#dfdfdf',
    borderRightColor: '#dfdfdf',
  },
});
