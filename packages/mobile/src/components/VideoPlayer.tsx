import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Image } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play, VolumeX } from 'lucide-react-native';
import { useActiveVideo } from '@/services/ActiveVideoContext';
import { useTheme } from '@/theme';
import { radius, spacing } from '@/theme/tokens';

interface VideoPlayerProps {
  playlist: string;
  thumbnail?: string;
  alt?: string;
  postUri?: string;
}

export function VideoPlayer({ playlist, thumbnail, alt, postUri }: VideoPlayerProps) {
  const { colors } = useTheme();
  const { activeVideoUri } = useActiveVideo();
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const videoRef = useRef<VideoView>(null);

  const isActive = postUri != null && activeVideoUri === postUri;

  const player = useVideoPlayer(started ? playlist : null, (p) => {
    p.loop = true;
    p.muted = true;
    if (started) p.play();
  });

  // Listen for ready state
  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'readyToPlay') setReady(true);
    });
    return () => {
      sub.remove();
    };
  }, [player]);

  // Autoplay when active, tear down when not
  useEffect(() => {
    if (isActive && !manualPause) {
      if (!started) {
        setStarted(true);
        setReady(false);
      } else {
        player.play();
      }
    } else if (!isActive && started && !manualPause) {
      // Kill video when scrolled off screen
      setStarted(false);
      setReady(false);
    }
  }, [isActive, manualPause]);

  const handlePlay = useCallback(() => {
    setManualPause(false);
    setStarted(true);
    setReady(false);
  }, []);

  const handleTapVideo = useCallback(() => {
    if (player.playing) {
      player.pause();
      setManualPause(true);
    } else {
      player.play();
      setManualPause(false);
    }
  }, [player]);

  // Always render thumbnail as base layer, video on top
  return (
    <View style={styles.container}>
      {/* Thumbnail — always present, acts as poster frame */}
      {thumbnail ? (
        <Image
          source={{ uri: thumbnail }}
          style={[styles.poster, !started || !ready ? undefined : styles.hiddenPoster]}
          resizeMode="cover"
          accessibilityLabel={alt || 'Video'}
        />
      ) : (
        <View style={[styles.poster, { backgroundColor: colors.base200 }]} />
      )}

      {/* Video layer — on top of thumbnail, only visible when ready */}
      {started ? (
        <Pressable style={[StyleSheet.absoluteFill]} onPress={handleTapVideo}>
          <VideoView
            ref={videoRef}
            player={player}
            style={[styles.video, !ready && { opacity: 0 }]}
            nativeControls={false}
            contentFit="contain"
          />
        </Pressable>
      ) : null}

      {/* Play button — shown when not started or paused */}
      {!started || manualPause ? (
        <Pressable style={styles.playOverlay} onPress={started ? handleTapVideo : handlePlay}>
          <View style={styles.playButton}>
            <Play size={20} color="#fff" fill="#fff" />
          </View>
        </Pressable>
      ) : null}

      {/* Mute indicator */}
      {started && ready && player.muted ? (
        <Pressable
          style={styles.muteButton}
          onPress={() => {
            player.muted = !player.muted;
          }}
        >
          <VolumeX size={14} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing[3],
    borderRadius: radius.md,
    overflow: 'hidden',
    height: 200,
  },
  poster: {
    width: '100%',
    height: 200,
    backgroundColor: '#e0e0e0',
  },
  hiddenPoster: {
    opacity: 0,
  },
  video: {
    width: '100%',
    height: 200,
  },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 20,
    marginLeft: 3,
  },
  muteButton: {
    position: 'absolute',
    bottom: spacing[2],
    right: spacing[2],
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 14,
  },
});
