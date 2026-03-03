/**
 * BeveledView — simulates Windows 98 raised/sunken/pressed borders.
 *
 * Two nested <View>s with per-side border colors replicate the 4-layer
 * inset CSS box-shadow used on web (`--cm-raised`, `--cm-sunken`).
 *
 * When the current theme is NOT AIM, renders a plain <View> — zero overhead.
 */

import React from 'react';
import { View, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { AIM_BEVEL, useAimStyle, type BevelVariant } from '@/theme/aim';

interface BeveledViewProps extends ViewProps {
  /** Which bevel effect to apply. Default: 'raised'. */
  variant?: BevelVariant;
  /** Extra style applied to the inner (content) view. */
  innerStyle?: StyleProp<ViewStyle>;
}

export const BeveledView = React.memo(function BeveledView({
  variant = 'raised',
  style,
  innerStyle,
  children,
  ...rest
}: BeveledViewProps) {
  const { isAim } = useAimStyle();

  if (!isAim) {
    return (
      <View style={style} {...rest}>
        {children}
      </View>
    );
  }

  const bevel = AIM_BEVEL[variant];

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderTopColor: bevel.outer.top,
          borderLeftColor: bevel.outer.left,
          borderBottomColor: bevel.outer.bottom,
          borderRightColor: bevel.outer.right,
        },
        style,
      ]}
      {...rest}
    >
      <View
        style={[
          {
            borderWidth: 1,
            borderTopColor: bevel.inner.top,
            borderLeftColor: bevel.inner.left,
            borderBottomColor: bevel.inner.bottom,
            borderRightColor: bevel.inner.right,
            flex: 1,
          },
          innerStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
});
