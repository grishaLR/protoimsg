import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { LocalParticipant, RemoteParticipant, Room } from 'livekit-client';
import {
  decodeData,
  encodeData,
  type ChatMessage,
  type DataMsg,
  type FloatingEmoji,
} from './types';

interface Args {
  room: Room;
  localParticipant: LocalParticipant;
  displayName: string;
  chatOpen: boolean;
}

/** Maximum chat messages kept in memory (matches the frontend cap convention). */
const MAX_CHAT_MESSAGES = 200;

/**
 * Owns everything that flows over the LiveKit data channel: chat, reaction
 * emojis, and display-name broadcasts. Keeps that churn out of the video grid.
 */
export function useGroupCallData({ room, localParticipant, displayName, chatOpen }: Args) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Names are state so the (memoized, isolated) video grid re-renders when a
  // peer's display name arrives. namesRef mirrors them for the PiP rAF loop,
  // which reads imperatively and must not pull names into an effect dep array.
  const [names, setNames] = useState<Record<string, string>>({});
  const namesRef = useRef(names);
  namesRef.current = names;

  // Mirror chatOpen in a ref so the receive handler doesn't need re-subscribing.
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  const spawnEmoji = useCallback((emoji: string) => {
    const fe: FloatingEmoji = {
      id: `${Date.now()}-${Math.random()}`,
      emoji,
      x: 10 + Math.random() * 80,
      ts: Date.now(),
    };
    setFloatingEmojis((prev) => [...prev, fe]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== fe.id));
    }, 3000);
  }, []);

  // ── Receive data channel messages ──
  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: RemoteParticipant) => {
      const msg = decodeData(payload);
      if (!msg) return;

      switch (msg.type) {
        case 'chat': {
          setChatMessages((prev) => [
            ...prev.slice(-MAX_CHAT_MESSAGES),
            {
              id: msg.id,
              sender: msg.sender,
              senderName: msg.senderName,
              text: msg.text,
              ts: Date.now(),
            },
          ]);
          if (!chatOpenRef.current) setUnreadCount((c) => c + 1);
          break;
        }
        case 'emoji':
          spawnEmoji(msg.emoji);
          break;
        case 'name':
          setNames((prev) =>
            prev[msg.sender] === msg.name ? prev : { ...prev, [msg.sender]: msg.name },
          );
          break;
      }
    };

    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room, spawnEmoji]);

  // ── Broadcast our display name on join + whenever a participant connects ──
  useEffect(() => {
    if (!displayName) return;
    setNames((prev) =>
      prev[localParticipant.identity] === displayName
        ? prev
        : { ...prev, [localParticipant.identity]: displayName },
    );
    const broadcast = () => {
      const msg = encodeData({
        type: 'name',
        sender: localParticipant.identity,
        name: displayName,
      });
      localParticipant.publishData(msg, { reliable: true }).catch(() => {});
    };
    broadcast();
    room.on(RoomEvent.ParticipantConnected, broadcast);
    return () => {
      room.off(RoomEvent.ParticipantConnected, broadcast);
    };
  }, [room, localParticipant, displayName]);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const msg: DataMsg = {
        type: 'chat',
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: localParticipant.identity,
        senderName: displayName || 'You',
        text: trimmed,
      };
      localParticipant.publishData(encodeData(msg), { reliable: true }).catch(() => {});
      setChatMessages((prev) => [
        ...prev.slice(-MAX_CHAT_MESSAGES),
        {
          id: msg.id,
          sender: msg.sender,
          senderName: msg.senderName,
          text: trimmed,
          ts: Date.now(),
        },
      ]);
    },
    [localParticipant, displayName],
  );

  const sendEmoji = useCallback(
    (emoji: string) => {
      const msg: DataMsg = { type: 'emoji', emoji, sender: localParticipant.identity };
      localParticipant.publishData(encodeData(msg), { reliable: true }).catch(() => {});
      spawnEmoji(emoji);
    },
    [localParticipant, spawnEmoji],
  );

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    chatMessages,
    floatingEmojis,
    unreadCount,
    names,
    namesRef,
    sendChat,
    sendEmoji,
    clearUnread,
  };
}
