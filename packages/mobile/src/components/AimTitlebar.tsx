/**
 * AimTitlebar — blue gradient titlebar with white bold text.
 *
 * Mirrors the classic AIM / Windows 98 window titlebar:
 * navy (#08216b) → light blue (#a5c6ef) horizontal gradient.
 *
 * Checks UIManager for the native ExpoLinearGradient view at init time.
 * Falls back to solid navy if the native module isn't linked (e.g. stale
 * binary, Expo Go, or prebuild hasn't run since adding the dependency).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, UIManager, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AIM_TITLEBAR_GRADIENT } from '@/theme/aim';
import { spacing, fontSize } from '@/theme/tokens';

// Check if the native view manager is actually registered before importing.
// The JS module always loads fine, but requireNativeViewManager returns a
// broken stub when the native side isn't built — producing the red
// "Unimplemented component: <ViewManagerAdapter" banner.
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- runtime safety: methods may not exist in all RN builds */
const hasNativeGradient =
  Platform.OS === 'ios'
    ? UIManager.getViewManagerConfig?.('ExpoLinearGradient') != null
    : (UIManager.hasViewManagerConfig?.('ExpoLinearGradient') ?? false);
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

let LinearGradientComponent: React.ComponentType<{
  colors: readonly string[];
  start: { x: number; y: number };
  end: { x: number; y: number };
  style: object;
  children: React.ReactNode;
}> | null = null;

if (hasNativeGradient) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const mod = require('expo-linear-gradient');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    LinearGradientComponent = mod.LinearGradient;
  } catch {
    // JS module failed to load — shouldn't happen, but handle gracefully
  }
}

interface AimTitlebarProps {
  title: string;
  onBack?: () => void;
}

export const AimTitlebar = React.memo(function AimTitlebar({ title, onBack }: AimTitlebarProps) {
  const { t } = useTranslation('common');
  const titleEl = (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('button.back')}
        >
          <Text style={styles.backText}>{'◀'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );

  if (!LinearGradientComponent) {
    return (
      <View style={[styles.container, { backgroundColor: AIM_TITLEBAR_GRADIENT[0] }]}>
        {titleEl}
      </View>
    );
  }

  const Gradient = LinearGradientComponent;

  return (
    <Gradient
      colors={[AIM_TITLEBAR_GRADIENT[0], AIM_TITLEBAR_GRADIENT[1]]}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={styles.container}
    >
      {titleEl}
    </Gradient>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  backButton: {
    paddingRight: spacing[1],
  },
  backText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
  },
  title: {
    color: '#ffffff',
    fontSize: fontSize.base,
    fontWeight: '700',
    flex: 1,
  },
});
