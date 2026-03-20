import React, { useCallback, useEffect } from 'react';
import { View, Image, Pressable, StyleSheet, Dimensions, Text, Modal } from 'react-native';
import { X } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

interface LightboxImage {
  uri: string;
  alt?: string;
  thumbRect?: { x: number; y: number; width: number; height: number };
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, visible, onClose }: ImageLightboxProps) {
  const [index, setIndex] = React.useState(initialIndex);

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  if (!visible || images.length === 0) return null;

  const image = images[index];

  return (
    <Modal visible transparent statusBarTranslucent animationType="none">
      <GestureHandlerRootView style={styles.root}>
        <LightboxContent
          image={image}
          index={index}
          total={images.length}
          onClose={onClose}
          onNext={() => {
            setIndex((i) => Math.min(i + 1, images.length - 1));
          }}
          onPrev={() => {
            setIndex((i) => Math.max(i - 1, 0));
          }}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

function LightboxContent({
  image,
  index,
  total,
  onClose,
  onNext,
  onPrev,
}: {
  image: LightboxImage;
  index: number;
  total: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const openProgress = useSharedValue(0);
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);

  // Open animation
  useEffect(() => {
    openProgress.value = withSpring(1, SPRING_CONFIG);
  }, []);

  const close = useCallback(() => {
    openProgress.value = withTiming(0, { duration: 200 }, (finished) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, openProgress]);

  // Pan to dismiss
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = e.translationY;
      translateX.value = e.translationX * 0.3;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 100 || Math.abs(e.velocityY) > 500) {
        translateY.value = withTiming(e.translationY > 0 ? SCREEN_H : -SCREEN_H, { duration: 200 });
        openProgress.value = withTiming(0, { duration: 200 }, (finished) => {
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          if (finished) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
      }
    });

  // Pinch to zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = e.scale;
    })
    .onEnd(() => {
      if (scale.value < 0.8) {
        scale.value = withTiming(0.5, { duration: 150 });
        openProgress.value = withTiming(0, { duration: 150 }, (finished) => {
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          if (finished) runOnJS(onClose)();
        });
      } else {
        scale.value = withSpring(1, SPRING_CONFIG);
      }
    });

  // Double tap to zoom
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withSpring(scale.value > 1.5 ? 1 : 2.5, SPRING_CONFIG);
    });

  // Single tap to close
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      runOnJS(close)();
    });

  // Swipe left/right for multi-image
  const swipeGesture = Gesture.Fling()
    .direction(1) // right
    .onEnd(() => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (index > 0) runOnJS(onPrev)();
    });

  const swipeLeftGesture = Gesture.Fling()
    .direction(2) // left
    .onEnd(() => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (index < total - 1) runOnJS(onNext)();
    });

  const composed = Gesture.Race(
    doubleTap,
    Gesture.Simultaneous(panGesture, pinchGesture),
    swipeGesture,
    swipeLeftGesture,
    singleTap,
  );

  const backdropStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(0,0,0,${interpolate(openProgress.value, [0, 1], [0, 0.95], Extrapolation.CLAMP)})`,
  }));

  const imageStyle = useAnimatedStyle(() => {
    const dismissOpacity = interpolate(
      Math.abs(translateY.value),
      [0, 200],
      [1, 0.5],
      Extrapolation.CLAMP,
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        {
          scale:
            scale.value * interpolate(openProgress.value, [0, 1], [0.7, 1], Extrapolation.CLAMP),
        },
      ],
      opacity: openProgress.value * dismissOpacity,
    };
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} />
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.imageContainer, imageStyle]}>
          <Image
            source={{ uri: image.uri }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={image.alt || 'Image'}
          />
        </Animated.View>
      </GestureDetector>

      {/* Close button */}
      <Pressable style={styles.closeButton} onPress={close} accessibilityLabel="Close">
        <X size={18} color="#fff" />
      </Pressable>

      {/* Page indicator */}
      {total > 1 ? (
        <View style={styles.pageIndicator}>
          <Text style={styles.pageText}>
            {index + 1} / {total}
          </Text>
        </View>
      ) : null}

      {/* Alt text */}
      {image.alt ? (
        <View style={styles.altContainer}>
          <Text style={styles.altText} numberOfLines={3}>
            {image.alt}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H * 0.8,
  },
  closeButton: {
    position: 'absolute',
    top: 54,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  pageIndicator: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pageText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  altContainer: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    padding: 10,
  },
  altText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 18,
  },
});
