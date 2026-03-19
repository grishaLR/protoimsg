import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  StyleSheet,
  Share,
  type ListRenderItemInfo,
} from 'react-native';
import { router } from 'expo-router';
import { useGroupCall } from '@/services/GroupCallContext';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';
import {
  MicOff,
  Mic,
  VideoOff,
  Video,
  PhoneOff,
  MessageSquare,
  Send,
  Smile,
  Copy,
  Users,
  X,
} from 'lucide-react-native';
import { RoomEvent, Track } from 'livekit-client';
import type { RemoteParticipant, Participant, TrackPublication } from 'livekit-client';
import { AudioSession } from '@livekit/react-native';
import {
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { LiveKitRoom, VideoTrack as RNVideoTrack } from '@livekit/react-native';

// ── Constants ──

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '😮', '💯'];

interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  text: string;
  ts: number;
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number;
  ts: number;
}

type DataMsg =
  | { type: 'chat'; id: string; sender: string; senderName: string; text: string }
  | { type: 'emoji'; emoji: string; sender: string }
  | { type: 'name'; sender: string; name: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeData(msg: DataMsg): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

function decodeData(data: Uint8Array): DataMsg | null {
  try {
    return JSON.parse(decoder.decode(data)) as DataMsg;
  } catch {
    return null;
  }
}

// ── Participant Tile ──

function ParticipantTile({
  trackRef,
  isLocal,
  isSpeaking,
  name,
  onPress,
  style,
}: {
  trackRef: { participant: Participant; publication?: TrackPublication; source: Track.Source };
  isLocal: boolean;
  isSpeaking: boolean;
  name: string;
  onPress: () => void;
  style?: object;
}) {
  const hasTrack = !!trackRef.publication?.track;

  return (
    <Pressable style={[styles.tile, isSpeaking && styles.tileSpeaking, style]} onPress={onPress}>
      {hasTrack ? (
        <RNVideoTrack
          trackRef={trackRef as TrackReference}
          style={styles.tileVideo}
          mirror={isLocal}
          objectFit="cover"
        />
      ) : (
        <View style={styles.tilePlaceholder}>
          <Text style={styles.tilePlaceholderText}>{name}</Text>
        </View>
      )}
      <View style={styles.tileLabel}>
        <Text style={styles.tileLabelText} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

// ── Inner component (inside LiveKitRoom context) ──

function GroupCallInner() {
  const { activeGroupCall, leaveGroupCall } = useGroupCall();
  const { colors } = useTheme();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();

  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showEmojis, setShowEmojis] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [pinnedSid, setPinnedSid] = useState<string | null>(null);
  const [activeSpeakerSid, setActiveSpeakerSid] = useState<string | null>(null);
  const participantNames = useRef<Map<string, string>>(new Map());
  const displayName = 'You';

  const videoTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  // Active speaker
  useEffect(() => {
    const handler = (speakers: Participant[]) => {
      const remote = speakers.find((s) => !s.isLocal);
      if (remote) setActiveSpeakerSid(remote.sid);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handler);
    };
  }, [room]);

  // Data channel
  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: RemoteParticipant) => {
      const msg = decodeData(payload);
      if (!msg) return;
      switch (msg.type) {
        case 'chat':
          setChatMessages((prev) => [...prev.slice(-200), { ...msg, ts: Date.now() }]);
          break;
        case 'emoji': {
          const fe: FloatingEmoji = {
            id: `${Date.now()}-${Math.random()}`,
            emoji: msg.emoji,
            x: 10 + Math.random() * 80,
            ts: Date.now(),
          };
          setFloatingEmojis((prev) => [...prev, fe]);
          setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== fe.id));
          }, 3000);
          break;
        }
        case 'name':
          participantNames.current.set(msg.sender, msg.name);
          break;
      }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room]);

  const toggleMute = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(isMuted);
    setIsMuted(!isMuted);
  }, [localParticipant, isMuted]);

  const toggleCamera = useCallback(() => {
    void localParticipant.setCameraEnabled(isCameraOff);
    setIsCameraOff(!isCameraOff);
  }, [localParticipant, isCameraOff]);

  const handleLeave = useCallback(() => {
    void room.disconnect();
    leaveGroupCall();
    // Navigation handled by auto-dismiss useEffect in GroupCallScreen
  }, [room, leaveGroupCall]);

  const copyMeetCode = useCallback(() => {
    if (!activeGroupCall?.meetCode) return;
    void Share.share({ message: `Join my protoimsg meeting: ${activeGroupCall.meetCode}` });
  }, [activeGroupCall?.meetCode]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    const msg: DataMsg = {
      type: 'chat',
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: localParticipant.identity,
      senderName: displayName,
      text,
    };
    void localParticipant.publishData(encodeData(msg), { reliable: true });
    setChatMessages((prev) => [...prev.slice(-200), { ...msg, ts: Date.now() }]);
    setChatInput('');
  }, [chatInput, localParticipant, displayName]);

  const sendEmoji = useCallback(
    (emoji: string) => {
      const msg: DataMsg = { type: 'emoji', emoji, sender: localParticipant.identity };
      void localParticipant.publishData(encodeData(msg), { reliable: true });
      const fe: FloatingEmoji = {
        id: `${Date.now()}-self`,
        emoji,
        x: 10 + Math.random() * 80,
        ts: Date.now(),
      };
      setFloatingEmojis((prev) => [...prev, fe]);
      setTimeout(() => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== fe.id));
      }, 3000);
    },
    [localParticipant],
  );

  const getLabel = (p: { identity: string; isLocal: boolean }) =>
    participantNames.current.get(p.identity) ?? (p.isLocal ? 'You' : p.identity.slice(0, 8));

  const trackKey = (tr: TrackReferenceOrPlaceholder) => `${tr.participant.sid}:${tr.source}`;

  const pinnedTrack = pinnedSid
    ? videoTracks.find((t: TrackReferenceOrPlaceholder) => t.participant.sid === pinnedSid)
    : null;
  const otherTracks = pinnedTrack
    ? videoTracks.filter((t: TrackReferenceOrPlaceholder) => trackKey(t) !== trackKey(pinnedTrack))
    : videoTracks;
  const cols = otherTracks.length <= 1 ? 1 : otherTracks.length <= 4 ? 2 : 3;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.base200 }]}>
        <Users size={16} color={colors.baseContent} />
        <Text style={[styles.headerTitle, { color: colors.baseContent }]}>
          Group Call ({participants.length})
        </Text>
        {activeGroupCall?.meetCode ? (
          <Pressable onPress={copyMeetCode} style={styles.codeButton}>
            <Text style={[styles.codeText, { color: colors.baseContent }]}>
              {activeGroupCall.meetCode}
            </Text>
            <Copy size={12} color={colors.baseContent} />
          </Pressable>
        ) : null}
        <Pressable onPress={handleLeave} style={styles.headerClose}>
          <X size={18} color="#fff" />
        </Pressable>
      </View>

      {/* Video area */}
      <View style={styles.videoArea}>
        {pinnedTrack && (
          <Pressable
            style={styles.pinnedContainer}
            onPress={() => {
              setPinnedSid(null);
            }}
          >
            <ParticipantTile
              trackRef={pinnedTrack}
              isLocal={pinnedTrack.participant.isLocal}
              isSpeaking={pinnedTrack.participant.sid === activeSpeakerSid}
              name={getLabel(pinnedTrack.participant)}
              onPress={() => {
                setPinnedSid(null);
              }}
              style={styles.pinnedTile}
            />
          </Pressable>
        )}

        <FlatList
          data={otherTracks}
          numColumns={pinnedTrack ? 1 : cols}
          key={`grid-${pinnedTrack ? 'strip' : cols}`}
          renderItem={({ item }: ListRenderItemInfo<TrackReferenceOrPlaceholder>) => (
            <ParticipantTile
              trackRef={item}
              isLocal={item.participant.isLocal}
              isSpeaking={item.participant.sid === activeSpeakerSid}
              name={getLabel(item.participant)}
              onPress={() => {
                setPinnedSid(item.participant.sid === pinnedSid ? null : item.participant.sid);
              }}
              style={
                pinnedTrack
                  ? styles.stripTile
                  : { flex: 1 / cols, aspectRatio: cols <= 2 ? 4 / 3 : 1 }
              }
            />
          )}
          keyExtractor={(item: TrackReferenceOrPlaceholder) => trackKey(item)}
          style={pinnedTrack ? styles.stripList : styles.gridList}
        />

        {floatingEmojis.map((e) => (
          <Text key={e.id} style={[styles.floatingEmoji, { left: `${e.x}%` as unknown as number }]}>
            {e.emoji}
          </Text>
        ))}
      </View>

      {/* Chat panel */}
      {chatOpen && (
        <View style={[styles.chatPanel, { backgroundColor: colors.base200 }]}>
          <FlatList
            data={chatMessages}
            renderItem={({ item }: ListRenderItemInfo<ChatMessage>) => (
              <View style={styles.chatRow}>
                <Text style={[styles.chatSender, { color: colors.primary }]}>
                  {item.sender === localParticipant.identity ? 'You' : item.senderName}:
                </Text>
                <Text style={[styles.chatText, { color: colors.baseContent }]}>{item.text}</Text>
              </View>
            )}
            keyExtractor={(item) => item.id}
            style={styles.chatList}
          />
          <View style={[styles.chatInputRow, { borderTopColor: colors.base300 }]}>
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendChat}
              placeholder="Message..."
              placeholderTextColor={colors.chromeTextMuted}
              style={[styles.chatInput, { color: colors.baseContent, borderColor: colors.base300 }]}
              returnKeyType="send"
            />
            <Pressable onPress={sendChat} style={styles.chatSendBtn}>
              <Send size={16} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      )}

      {showEmojis && (
        <View style={[styles.emojiBar, { backgroundColor: colors.base200 }]}>
          {EMOJI_OPTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                sendEmoji(emoji);
              }}
              style={styles.emojiBtn}
            >
              <Text style={styles.emojiBtnText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.controlBar}>
        <ControlButton
          icon={isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
          onPress={toggleMute}
          active={isMuted}
        />
        <ControlButton
          icon={
            isCameraOff ? <VideoOff size={22} color="#fff" /> : <Video size={22} color="#fff" />
          }
          onPress={toggleCamera}
          active={isCameraOff}
        />
        <ControlButton
          icon={<Smile size={22} color="#fff" />}
          onPress={() => {
            setShowEmojis((v) => !v);
          }}
          active={showEmojis}
        />
        <ControlButton
          icon={<MessageSquare size={22} color="#fff" />}
          onPress={() => {
            setChatOpen((v) => !v);
          }}
          active={chatOpen}
        />
        <ControlButton
          icon={<PhoneOff size={22} color="#fff" />}
          onPress={handleLeave}
          active={false}
          destructive
        />
      </View>
    </View>
  );
}

// ── Main screen ──

export default function GroupCallScreen() {
  const { activeGroupCall } = useGroupCall();

  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  useEffect(() => {
    if (!activeGroupCall) {
      if (router.canDismiss()) router.dismiss();
      else router.replace('/(tabs)/buddy-list');
    }
  }, [activeGroupCall]);

  if (!activeGroupCall) return null;

  return (
    <LiveKitRoom
      token={activeGroupCall.token}
      serverUrl={activeGroupCall.url}
      connect={true}
      audio={false}
      video={false}
    >
      <GroupCallInner />
    </LiveKitRoom>
  );
}

function ControlButton({
  icon,
  onPress,
  active,
  destructive,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  active: boolean;
  destructive?: boolean;
}) {
  const bg = destructive ? '#ef4444' : active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)';
  return (
    <Pressable style={[styles.controlButton, { backgroundColor: bg }]} onPress={onPress}>
      {icon}
    </Pressable>
  );
}

const CONTROL_SIZE = 50;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: 50,
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  headerTitle: { fontSize: fontSize.md, fontWeight: '600', flex: 1 },
  codeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  codeText: { fontSize: fontSize.xs, fontFamily: 'monospace' },
  headerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoArea: { flex: 1, position: 'relative' },
  gridList: { flex: 1 },
  stripList: { width: 120, position: 'absolute', right: 0, top: 0, bottom: 0 },
  pinnedContainer: { flex: 1, marginRight: 122 },
  pinnedTile: { flex: 1 },
  stripTile: { height: 90, marginBottom: 2 },
  tile: {
    margin: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    minHeight: 80,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSpeaking: { borderColor: '#22c55e' },
  tileVideo: { flex: 1 },
  tilePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  tilePlaceholderText: { color: 'rgba(255,255,255,0.5)', fontSize: fontSize.lg, fontWeight: '700' },
  tileLabel: { position: 'absolute', bottom: 2, left: 4 },
  tileLabelText: {
    color: '#fff',
    fontSize: 10,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  floatingEmoji: { position: 'absolute', bottom: 0, fontSize: 32 },
  chatPanel: { height: 200, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  chatList: { flex: 1, paddingHorizontal: spacing[3] },
  chatRow: { flexDirection: 'row', marginBottom: 2 },
  chatSender: { fontWeight: '700', fontSize: fontSize.sm, marginRight: 4 },
  chatText: { fontSize: fontSize.sm, flex: 1 },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    fontSize: fontSize.sm,
  },
  chatSendBtn: { padding: spacing[2] },
  emojiBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  emojiBtn: { padding: spacing[1] },
  emojiBtnText: { fontSize: 24 },
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[4],
    paddingVertical: spacing[4],
    paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  controlButton: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
