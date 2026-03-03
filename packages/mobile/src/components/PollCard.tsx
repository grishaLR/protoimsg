import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from '@/components/Avatar';
import type { PollView } from '@/types';
import type { ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

interface PollCardProps {
  poll: PollView;
  colors: ThemeColors;
  isAim: boolean;
  onVote: (pollId: string, pollUri: string, selectedOptions: number[]) => void;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return '';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const PollCard = React.memo(function PollCard({
  poll,
  colors,
  isAim,
  onVote,
}: PollCardProps) {
  const { t } = useTranslation('chat');
  const profile = useProfile(poll.did);
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
  const hasVoted = poll.myVote !== null;
  const expired = isExpired(poll.expires_at);
  const showResults = hasVoted || expired;
  const borderRadius = isAim ? 0 : radius.md;

  const handle =
    profile?.displayName ?? profile?.handle ?? poll.did.split(':').pop()?.slice(0, 12) ?? poll.did;

  const maxCount = useMemo(() => {
    const counts = Object.values(poll.tallies);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [poll.tallies]);

  const handleOptionPress = useCallback(
    (index: number) => {
      if (hasVoted || expired || poll.pending) return;

      if (poll.allow_multiple) {
        setSelectedOptions((prev) => {
          const next = new Set(prev);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return next;
        });
      } else {
        onVote(poll.id, poll.uri, [index]);
      }
    },
    [hasVoted, expired, poll.pending, poll.allow_multiple, poll.id, poll.uri, onVote],
  );

  const handleSubmitMultiple = useCallback(() => {
    if (selectedOptions.size === 0) return;
    onVote(poll.id, poll.uri, [...selectedOptions]);
  }, [poll.id, poll.uri, selectedOptions, onVote]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.base200,
          borderRadius,
          opacity: poll.pending ? 0.6 : 1,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Avatar url={profile?.avatarUrl} name={handle} size="sm" />
        <Text style={[styles.handle, { color: colors.secondary }]} numberOfLines={1}>
          {handle}
        </Text>
        <Text style={[styles.time, { color: colors.chromeTextMuted }]}>
          {formatTime(poll.created_at)}
        </Text>
        {poll.allow_multiple ? (
          <View style={[styles.badge, { backgroundColor: colors.base300, borderRadius }]}>
            <Text style={[styles.badgeText, { color: colors.chromeTextMuted }]}>
              {t('poll.allowMultiple')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Question */}
      <Text style={[styles.question, { color: colors.baseContent }]}>{poll.question}</Text>

      {/* Options */}
      {poll.options.map((option, index) => {
        const count = poll.tallies[index] ?? 0;
        const pct = poll.totalVoters > 0 ? count / poll.totalVoters : 0;
        const isSelected = hasVoted ? poll.myVote?.includes(index) : selectedOptions.has(index);
        const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;

        return (
          <Pressable
            key={index}
            style={[
              styles.option,
              {
                backgroundColor: isSelected ? colors.primary + '22' : colors.surface,
                borderColor: isSelected ? colors.primary : colors.borderLight,
                borderRadius,
              },
            ]}
            onPress={() => {
              handleOptionPress(index);
            }}
            disabled={hasVoted || expired}
            accessibilityRole="button"
          >
            {showResults ? (
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${barWidth}%`,
                    backgroundColor: isSelected ? colors.primary + '33' : colors.base300,
                    borderRadius,
                  },
                ]}
              />
            ) : null}
            <View style={styles.optionContent}>
              <Text
                style={[
                  styles.optionLabel,
                  { color: colors.baseContent },
                  isSelected && { fontWeight: '600' },
                ]}
              >
                {option}
              </Text>
              {showResults ? (
                <Text style={[styles.optionCount, { color: colors.chromeTextMuted }]}>
                  {count} ({Math.round(pct * 100)}%)
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {/* Multi-select submit */}
      {poll.allow_multiple && !hasVoted && !expired && selectedOptions.size > 0 ? (
        <Pressable
          style={[styles.submitVote, { backgroundColor: colors.primary, borderRadius }]}
          onPress={handleSubmitMultiple}
          accessibilityRole="button"
        >
          <Text style={[styles.submitVoteText, { color: colors.primaryContent }]}>
            {t('poll.vote')}
          </Text>
        </Pressable>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.voters, { color: colors.chromeTextMuted }]}>
          {t('poll.totalVotes', { count: poll.totalVoters })}
        </Text>
        {poll.expires_at && !expired ? (
          <Text style={[styles.expiry, { color: colors.chromeTextMuted }]}>
            {t('poll.expiresIn', { time: formatExpiry(poll.expires_at) })}
          </Text>
        ) : null}
        {expired ? (
          <Text style={[styles.expiry, { color: colors.chromeTextMuted }]}>
            {t('poll.expired')}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[5],
    marginHorizontal: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  handle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    flex: 1,
  },
  time: {
    fontSize: fontSize['2xs'],
  },
  badge: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  badgeText: {
    fontSize: fontSize['2xs'],
  },
  question: {
    fontSize: fontSize.base,
    fontWeight: '700',
    marginBottom: spacing[4],
  },
  option: {
    borderWidth: 1,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    marginBottom: spacing[2],
    overflow: 'hidden',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
  optionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionLabel: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  optionCount: {
    fontSize: fontSize.xs,
    marginLeft: spacing[3],
  },
  submitVote: {
    marginTop: spacing[3],
    paddingVertical: spacing[4],
    alignItems: 'center',
  },
  submitVoteText: {
    fontSize: fontSize.base,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[3],
  },
  voters: {
    fontSize: fontSize.xs,
  },
  expiry: {
    fontSize: fontSize.xs,
  },
});
