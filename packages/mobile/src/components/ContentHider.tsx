import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

interface ContentHiderProps {
  /** Hide content entirely — render nothing */
  filter?: boolean;
  /** Blur content behind a "Show" overlay */
  blur?: boolean;
  /** Show a warning banner above the content */
  alert?: boolean;
  /** Warning/label text to display */
  label?: string;
  children: ReactNode;
}

export function ContentHider({ filter, blur, alert, label, children }: ContentHiderProps) {
  const { colors } = useTheme();
  const [revealed, setRevealed] = useState(false);

  if (filter) return null;

  if (blur && !revealed) {
    return (
      <View style={styles.blurContainer}>
        <View style={[styles.blurOverlay, { backgroundColor: colors.base200 }]}>
          <Text style={[styles.blurLabel, { color: colors.chromeTextMuted }]}>
            {label ?? 'Content warning'}
          </Text>
          <Pressable
            style={[styles.showButton, { backgroundColor: colors.base300 }]}
            onPress={() => {
              setRevealed(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Show content"
          >
            <Text style={[styles.showButtonText, { color: colors.baseContent }]}>Show</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View>
      {alert && label ? (
        <View style={[styles.alertBanner, { backgroundColor: colors.base200 }]}>
          <Text style={[styles.alertText, { color: colors.warning }]}>{label}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  blurContainer: {
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  blurOverlay: {
    padding: spacing[8],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    minHeight: 80,
    borderRadius: radius.md,
  },
  blurLabel: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  showButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.sm,
  },
  showButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  alertBanner: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.sm,
    marginBottom: spacing[2],
  },
  alertText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
