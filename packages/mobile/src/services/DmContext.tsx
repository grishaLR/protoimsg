import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWebSocket } from './WebSocketContext';
import { useAuth } from './auth';
import { fetchIceServers } from './api';
import {
  DataChannelPeer,
  isWebRTCAvailable,
  type DataChannelPeerConfig,
  type DcTextMessage,
  type DataChannelState,
} from './datachannel';
import type { DmMessageView, DmConversation, DmNotification } from '../types';
import type { ServerMessage, IceCandidateInit } from '@protoimsg/shared';

const MAX_MESSAGES = 200;
const MAX_NOTIFICATIONS = 20;
const CONNECTION_TIMEOUT_MS = 30_000;

// -- Inner circle IP protection (mirrors web's ip-protection.ts) --
// Two levels:
//   'non-inner-circle' (default) — relay for everyone EXCEPT inner circle
//   'all'                        — relay for ALL peers
// Inner circle snapshot is set from buddy list screen.

import { storage } from './storage';

export type IpProtectionLevel = 'non-inner-circle' | 'all';

let innerCircleDidsSnapshot: ReadonlySet<string> = new Set();

export function setInnerCircleDids(dids: ReadonlySet<string>): void {
  innerCircleDidsSnapshot = dids;
}

export function getIpProtectionLevel(): IpProtectionLevel {
  const stored = storage.getString('protoimsg:ipProtection');
  if (stored === 'non-inner-circle' || stored === 'all') return stored;
  return 'non-inner-circle';
}

export function setIpProtectionLevel(level: IpProtectionLevel): void {
  storage.set('protoimsg:ipProtection', level);
}

export function shouldForceRelay(recipientDid: string): boolean {
  const level = getIpProtectionLevel();
  if (level === 'all') return true;
  // 'non-inner-circle' — relay unless recipient is in inner circle
  return !innerCircleDidsSnapshot.has(recipientDid);
}

/** Simple UUID replacement for Hermes (no crypto.randomUUID) */
export function generateId(): string {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

interface DmContextValue {
  conversations: DmConversation[];
  notifications: DmNotification[];
  openDm: (recipientDid: string) => void;
  closeDm: (conversationId: string) => void;
  sendDm: (conversationId: string, text: string, facets?: unknown[], embed?: unknown) => void;
  sendTyping: (conversationId: string) => void;
  retryConnection: (conversationId: string) => void;
  dismissNotification: (conversationId: string, reject?: boolean) => void;
  openFromNotification: (notification: DmNotification) => void;
}

const DmContext = createContext<DmContextValue | null>(null);

/** Trim array to last N items */
function trimMessages(msgs: DmMessageView[]): DmMessageView[] {
  return msgs.length > MAX_MESSAGES ? msgs.slice(-MAX_MESSAGES) : msgs;
}

export function DmProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useWebSocket();
  const { did } = useAuth();
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [notifications, setNotifications] = useState<DmNotification[]>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSent = useRef<Map<string, number>>(new Map());
  const connectionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const closingTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // P2P data channel state
  const peersRef = useRef<Map<string, DataChannelPeer>>(new Map());
  const pendingQueue = useRef<Map<string, DcTextMessage[]>>(new Map());
  const pendingOffers = useRef<Map<string, { senderDid: string; offer: string }>>(new Map());
  const pendingIceCandidates = useRef<Map<string, IceCandidateInit[]>>(new Map());

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  /** Create a DataChannelPeer and wire up callbacks */
  const createPeer = useCallback(
    (conversationId: string, isCaller: boolean, rtcConfig: DataChannelPeerConfig['rtcConfig']) => {
      const existing = peersRef.current.get(conversationId);
      if (existing) {
        existing.close();
        peersRef.current.delete(conversationId);
      }

      const peer = new DataChannelPeer({
        rtcConfig,
        conversationId,
        send,
        isCaller,
        onMessage: (msg: DcTextMessage) => {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.conversationId !== conversationId) return c;
              if (c.messages.some((m) => m.id === msg.id)) return c;
              const remoteMsg: DmMessageView = {
                id: msg.id,
                conversationId,
                senderDid: c.recipientDid,
                text: msg.text,
                createdAt: msg.ts,
              };
              if (msg.facets && msg.facets.length > 0) remoteMsg.facets = msg.facets;
              if (msg.embed) remoteMsg.embed = msg.embed;
              return {
                ...c,
                messages: trimMessages([...c.messages, remoteMsg]),
              };
            }),
          );
        },
        onTyping: () => {
          setConversations((prev) =>
            prev.map((c) => (c.conversationId === conversationId ? { ...c, typing: true } : c)),
          );

          const prevTimer = typingTimers.current.get(conversationId);
          if (prevTimer) clearTimeout(prevTimer);

          const timer = setTimeout(() => {
            setConversations((prev) =>
              prev.map((c) => (c.conversationId === conversationId ? { ...c, typing: false } : c)),
            );
            typingTimers.current.delete(conversationId);
          }, 3000);
          typingTimers.current.set(conversationId, timer);
        },
        onStateChange: (state: DataChannelState) => {
          setConversations((prev) =>
            prev.map((c) => (c.conversationId === conversationId ? { ...c, peerState: state } : c)),
          );

          if (state === 'open') {
            const ct = connectionTimers.current.get(conversationId);
            if (ct) {
              clearTimeout(ct);
              connectionTimers.current.delete(conversationId);
            }

            const queued = pendingQueue.current.get(conversationId);
            if (queued) {
              for (const msg of queued) {
                peer.sendMessage(msg);
              }
              pendingQueue.current.delete(conversationId);
            }
          }
        },
      });

      peersRef.current.set(conversationId, peer);

      const ct = setTimeout(() => {
        connectionTimers.current.delete(conversationId);
        if (peer.state === 'connecting') {
          peer.close();
          peersRef.current.delete(conversationId);
          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId ? { ...c, peerState: 'failed' } : c,
            ),
          );
        }
      }, CONNECTION_TIMEOUT_MS);
      connectionTimers.current.set(conversationId, ct);

      return peer;
    },
    [send],
  );

  /** Initiate a data channel connection as caller */
  const initiatePeerConnection = useCallback(
    async (conversationId: string, recipientDid: string) => {
      if (!isWebRTCAvailable()) {
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === conversationId ? { ...c, peerState: 'failed' } : c,
          ),
        );
        return;
      }
      try {
        const iceServers = await fetchIceServers();
        const useRelay = shouldForceRelay(recipientDid);
        const rtcConfig = {
          iceServers,
          ...(useRelay && { iceTransportPolicy: 'relay' as const }),
        };
        const peer = createPeer(conversationId, true, rtcConfig);
        await peer.createOffer();
      } catch (err) {
        console.error('Failed to initiate data channel', err);
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === conversationId ? { ...c, peerState: 'failed' } : c,
          ),
        );
      }
    },
    [createPeer],
  );

  /** Accept an incoming offer as callee */
  const acceptPeerConnection = useCallback(
    async (conversationId: string, recipientDid: string, offerSdp: string) => {
      if (!isWebRTCAvailable()) return;
      try {
        const iceServers = await fetchIceServers();
        const useRelay = shouldForceRelay(recipientDid);
        const rtcConfig = {
          iceServers,
          ...(useRelay && { iceTransportPolicy: 'relay' as const }),
        };
        const peer = createPeer(conversationId, false, rtcConfig);
        await peer.handleOffer(offerSdp);

        const buffered = pendingIceCandidates.current.get(conversationId);
        if (buffered) {
          for (const c of buffered) {
            peer.addBufferedCandidate(c);
          }
          pendingIceCandidates.current.delete(conversationId);
        }
      } catch (err) {
        console.error('Failed to accept data channel', err);
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === conversationId ? { ...c, peerState: 'failed' } : c,
          ),
        );
      }
    },
    [createPeer],
  );

  const openDm = useCallback(
    (recipientDid: string) => {
      const existing = conversationsRef.current.find((c) => c.recipientDid === recipientDid);
      if (existing) return;
      send({ type: 'dm_open', recipientDid });
    },
    [send],
  );

  const closeDm = useCallback(
    (conversationId: string) => {
      const typingTimer = typingTimers.current.get(conversationId);
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimers.current.delete(conversationId);
      }
      lastTypingSent.current.delete(conversationId);

      const ct = connectionTimers.current.get(conversationId);
      if (ct) {
        clearTimeout(ct);
        connectionTimers.current.delete(conversationId);
      }

      const closing = closingTimers.current.get(conversationId);
      if (closing) {
        clearInterval(closing);
        closingTimers.current.delete(conversationId);
      }

      const peer = peersRef.current.get(conversationId);
      if (peer) {
        peer.close();
        peersRef.current.delete(conversationId);
      }
      pendingQueue.current.delete(conversationId);
      pendingOffers.current.delete(conversationId);
      pendingIceCandidates.current.delete(conversationId);

      send({ type: 'dm_close', conversationId });
      setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
      conversationsRef.current = conversationsRef.current.filter(
        (c) => c.conversationId !== conversationId,
      );
    },
    [send],
  );

  const sendDm = useCallback(
    (conversationId: string, text: string, facets?: unknown[], embed?: unknown) => {
      if (!did) return;
      const msg: DcTextMessage = {
        type: 'text',
        id: `local-${generateId()}`,
        text,
        ts: new Date().toISOString(),
      };
      if (facets && facets.length > 0) msg.facets = facets;
      if (embed) msg.embed = embed;

      const peer = peersRef.current.get(conversationId);
      if (peer?.state === 'open') {
        peer.sendMessage(msg);
      } else {
        const queue = pendingQueue.current.get(conversationId) ?? [];
        queue.push(msg);
        pendingQueue.current.set(conversationId, queue);
      }

      const localMsg: DmMessageView = {
        id: msg.id,
        conversationId,
        senderDid: did,
        text: msg.text,
        createdAt: msg.ts,
      };
      if (facets && facets.length > 0) localMsg.facets = facets;
      if (embed) localMsg.embed = embed;
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, messages: trimMessages([...c.messages, localMsg]) }
            : c,
        ),
      );
    },
    [did],
  );

  const sendTyping = useCallback((conversationId: string) => {
    const now = Date.now();
    const last = lastTypingSent.current.get(conversationId) ?? 0;
    if (now - last < 3000) return;
    lastTypingSent.current.set(conversationId, now);

    const peer = peersRef.current.get(conversationId);
    if (peer?.state === 'open') {
      peer.sendTyping();
    }
  }, []);

  const retryConnection = useCallback(
    (conversationId: string) => {
      const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);
      if (!convo) return;

      const peer = peersRef.current.get(conversationId);
      if (peer) {
        peer.close();
        peersRef.current.delete(conversationId);
      }

      const ct = connectionTimers.current.get(conversationId);
      if (ct) {
        clearTimeout(ct);
        connectionTimers.current.delete(conversationId);
      }

      const closing = closingTimers.current.get(conversationId);
      if (closing) {
        clearInterval(closing);
        closingTimers.current.delete(conversationId);
      }

      pendingIceCandidates.current.delete(conversationId);

      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, peerState: 'connecting', closingIn: null }
            : c,
        ),
      );

      void initiatePeerConnection(conversationId, convo.recipientDid);
    },
    [initiatePeerConnection],
  );

  const dismissNotification = useCallback(
    (conversationId: string, reject?: boolean) => {
      if (reject) {
        pendingOffers.current.delete(conversationId);
        pendingIceCandidates.current.delete(conversationId);
        send({ type: 'dm_reject', conversationId });
      }
      setNotifications((prev) => prev.filter((n) => n.conversationId !== conversationId));
    },
    [send],
  );

  const openFromNotification = useCallback(
    (notification: DmNotification) => {
      dismissNotification(notification.conversationId);
      openDm(notification.senderDid);
    },
    [dismissNotification, openDm],
  );

  // WS event handler
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'dm_opened': {
          const { conversationId, recipientDid } = msg.data;
          setNotifications((prev) => prev.filter((n) => n.conversationId !== conversationId));

          setConversations((prev) => {
            if (prev.some((c) => c.conversationId === conversationId)) return prev;

            const newConvo: DmConversation = {
              conversationId,
              recipientDid,
              messages: [],
              typing: false,
              peerState: 'connecting',
              closingIn: null,
            };
            return [...prev, newConvo];
          });

          const pending = pendingOffers.current.get(conversationId);
          if (pending) {
            pendingOffers.current.delete(conversationId);
            void acceptPeerConnection(conversationId, recipientDid, pending.offer);
          } else {
            void initiatePeerConnection(conversationId, recipientDid);
          }
          break;
        }

        case 'im_offer': {
          const { conversationId, senderDid, offer } = msg.data;
          const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);

          if (convo) {
            const existingPeer = peersRef.current.get(conversationId);

            // Glare resolution: lower DID is the "polite" peer that yields
            if (existingPeer?.isCaller && existingPeer.state === 'connecting' && did) {
              const weArePolite = did < senderDid;
              if (!weArePolite) {
                break;
              }
            }

            void acceptPeerConnection(conversationId, convo.recipientDid, offer);
          } else {
            // Buffer the offer, show notification
            pendingOffers.current.set(conversationId, { senderDid, offer });

            setNotifications((n) => {
              if (n.some((x) => x.conversationId === conversationId)) return n;
              const updated = [
                ...n,
                {
                  conversationId,
                  senderDid,
                  receivedAt: new Date().toISOString(),
                },
              ];
              return updated.length > MAX_NOTIFICATIONS
                ? updated.slice(-MAX_NOTIFICATIONS)
                : updated;
            });
          }
          break;
        }

        case 'im_answer': {
          const { conversationId, answer } = msg.data;
          const peer = peersRef.current.get(conversationId);
          if (!peer) break;
          void peer.handleAnswer(answer).catch((err: unknown) => {
            console.error('Failed to handle IM answer', err);
          });
          break;
        }

        case 'im_ice_candidate': {
          const { conversationId, candidate } = msg.data;
          const peer = peersRef.current.get(conversationId);
          if (peer) {
            peer.addBufferedCandidate(candidate);
          } else {
            const buf = pendingIceCandidates.current.get(conversationId) ?? [];
            buf.push(candidate);
            pendingIceCandidates.current.set(conversationId, buf);
          }
          break;
        }

        case 'dm_partner_left': {
          const { conversationId } = msg.data;
          const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);
          if (!convo) break;

          const closingTimer = closingTimers.current.get(conversationId);
          if (closingTimer) {
            clearInterval(closingTimer);
            closingTimers.current.delete(conversationId);
          }

          const existingPeer = peersRef.current.get(conversationId);
          if (existingPeer) {
            existingPeer.close();
            peersRef.current.delete(conversationId);
          }

          const ct = connectionTimers.current.get(conversationId);
          if (ct) {
            clearTimeout(ct);
            connectionTimers.current.delete(conversationId);
          }
          pendingIceCandidates.current.delete(conversationId);

          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId
                ? { ...c, peerState: 'connecting', closingIn: null }
                : c,
            ),
          );
          void initiatePeerConnection(conversationId, convo.recipientDid);
          break;
        }

        case 'dm_rejected': {
          const { conversationId } = msg.data;
          const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);
          if (!convo) break;

          const rejectedPeer = peersRef.current.get(conversationId);
          if (rejectedPeer) {
            rejectedPeer.close();
            peersRef.current.delete(conversationId);
          }
          const ct2 = connectionTimers.current.get(conversationId);
          if (ct2) {
            clearTimeout(ct2);
            connectionTimers.current.delete(conversationId);
          }

          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId
                ? { ...c, peerState: 'closed', closingIn: 10 }
                : c,
            ),
          );

          const prevClosing = closingTimers.current.get(conversationId);
          if (prevClosing) clearInterval(prevClosing);

          const interval = setInterval(() => {
            const current = conversationsRef.current.find(
              (c) => c.conversationId === conversationId,
            );
            if (!current || current.closingIn === null) {
              clearInterval(interval);
              closingTimers.current.delete(conversationId);
              return;
            }
            const next = current.closingIn - 1;
            if (next <= 0) {
              clearInterval(interval);
              closingTimers.current.delete(conversationId);
              closeDm(conversationId);
            } else {
              setConversations((prev) =>
                prev.map((c) =>
                  c.conversationId === conversationId ? { ...c, closingIn: next } : c,
                ),
              );
            }
          }, 1000);
          closingTimers.current.set(conversationId, interval);
          break;
        }
      }
    });

    return () => {
      unsub();
      for (const timer of typingTimers.current.values()) {
        clearTimeout(timer);
      }
      typingTimers.current.clear();
    };
  }, [subscribe, send, did, initiatePeerConnection, acceptPeerConnection, closeDm]);

  // Clean up timers + peers on unmount
  useEffect(() => {
    return () => {
      for (const timer of connectionTimers.current.values()) {
        clearTimeout(timer);
      }
      connectionTimers.current.clear();
      for (const timer of closingTimers.current.values()) {
        clearInterval(timer);
      }
      closingTimers.current.clear();
      for (const peer of peersRef.current.values()) {
        peer.close();
      }
      peersRef.current.clear();
    };
  }, []);

  const value = useMemo<DmContextValue>(
    () => ({
      conversations,
      notifications,
      openDm,
      closeDm,
      sendDm,
      sendTyping,
      retryConnection,
      dismissNotification,
      openFromNotification,
    }),
    [
      conversations,
      notifications,
      openDm,
      closeDm,
      sendDm,
      sendTyping,
      retryConnection,
      dismissNotification,
      openFromNotification,
    ],
  );

  return <DmContext.Provider value={value}>{children}</DmContext.Provider>;
}

export function useDm(): DmContextValue {
  const ctx = useContext(DmContext);
  if (!ctx) throw new Error('useDm must be used within DmProvider');
  return ctx;
}
