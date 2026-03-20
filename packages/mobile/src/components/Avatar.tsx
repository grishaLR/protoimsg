import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { useTheme, useAimStyle } from '@/theme';
import { avatarSize as avatarTokens, fontSize } from '@/theme/tokens';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  url?: string;
  name?: string;
  size?: AvatarSize;
}

const SIZES: Record<AvatarSize, number> = {
  sm: avatarTokens.sm,
  md: avatarTokens.md,
  lg: avatarTokens.lg,
};

const FONT_SIZES: Record<AvatarSize, number> = {
  sm: fontSize['2xs'],
  md: fontSize.xs,
  lg: fontSize['2xl'],
};

export const Avatar = React.memo(function Avatar({ url, name, size = 'md' }: AvatarProps) {
  const { colors } = useTheme();
  const { aimRadius } = useAimStyle();
  const [failed, setFailed] = useState(false);
  const px = SIZES[size];
  const borderRadius = aimRadius ?? px / 2;

  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.image, { width: px, height: px, borderRadius }]}
        onError={() => {
          setFailed(true);
        }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const initial = (name && name.length > 0 ? name[0] : '?').toUpperCase();

  return (
    <View
      style={[
        styles.fallback,
        {
          width: px,
          height: px,
          borderRadius,
          backgroundColor: colors.base300,
        },
      ]}
    >
      <Text style={[styles.initial, { color: colors.baseContent, fontSize: FONT_SIZES[size] }]}>
        {initial}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  image: {
    flexShrink: 0,
  },
  fallback: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
