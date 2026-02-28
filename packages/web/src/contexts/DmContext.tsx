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
import { useAuth } from '../hooks/useAuth';
import { playImNotify } from '../lib/sounds';
import { fetchIceServers } from '../lib/api';
import { shouldForceRelayForDid } from '../lib/ip-protection';
import { DataChannelPeer, type DcTextMessage, type DataChannelState } from '../lib/datachannel';
import { IS_TAURI } from '../lib/config';
import type { DmMessageView } from '../types';
import type { ServerMessage, IceCandidateInit } from '@protoimsg/shared';

const MAX_OPEN_POPOVERS = 4;
const MAX_MESSAGES = 200;
const MAX_NOTIFICATIONS = 20;
const CONNECTION_TIMEOUT_MS = 30_000;

export interface DmConversation {
  conversationId: string;
  recipientDid: string;
  messages: DmMessageView[];
  minimized: boolean;
  typing: boolean;
  unreadCount: number;
  peerState: DataChannelState;
  /** Countdown seconds until auto-close (null = not closing) */
  closingIn: number | null;
}

export interface DmNotification {
  conversationId: string;
  senderDid: string;
  receivedAt: string;
}

interface DmContextValue {
  conversations: DmConversation[];
  notifications: DmNotification[];
  openDm: (recipientDid: string) => void;
  openDmMinimized: (recipientDid: string) => void;
  closeDm: (conversationId: string) => void;
  toggleMinimize: (conversationId: string) => void;
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

  // M24: pendingMinimized — ref to track "open minimized" intent across async boundary.
  const pendingMinimized = useRef<Set<string>>(new Set());

  // M24: conversationsRef — ref mirror of conversations state.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  /** Create a DataChannelPeer and wire up callbacks */
  const createPeer = useCallback(
    (conversationId: string, isCaller: boolean, rtcConfig: RTCConfiguration) => {
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
          // Play sound if minimized
          const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);
          if (convo?.minimized) {
            playImNotify();
          }

          // The sender DID is the recipient of our conversation (remote peer)
          setConversations((prev) =>
            prev.map((c) => {
              if (c.conversationId !== conversationId) return c;
              // Dedup by message ID
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
                unreadCount: c.minimized ? c.unreadCount + 1 : c.unreadCount,
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
            // Clear connection timeout
            const ct = connectionTimers.current.get(conversationId);
            if (ct) {
              clearTimeout(ct);
              connectionTimers.current.delete(conversationId);
            }

            // Flush pending messages
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

      // Start connection timeout — close the peer if it doesn't open in time
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
      try {
        const iceServers = await fetchIceServers();
        const useRelay = shouldForceRelayForDid(recipientDid);
        const rtcConfig: RTCConfiguration = {
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
      try {
        const iceServers = await fetchIceServers();
        const useRelay = shouldForceRelayForDid(recipientDid);
        const rtcConfig: RTCConfiguration = {
          iceServers,
          ...(useRelay && { iceTransportPolicy: 'relay' as const }),
        };
        const peer = createPeer(conversationId, false, rtcConfig);
        await peer.handleOffer(offerSdp);

        // Flush buffered ICE candidates
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
      if (existing) {
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === existing.conversationId
              ? { ...c, minimized: false, unreadCount: 0 }
              : c,
          ),
        );
        return;
      }
      send({ type: 'dm_open', recipientDid });
    },
    [send],
  );

  const openDmMinimized = useCallback(
    (recipientDid: string) => {
      const existing = conversationsRef.current.find((c) => c.recipientDid === recipientDid);
      if (existing) {
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === existing.conversationId ? { ...c, minimized: true } : c,
          ),
        );
        return;
      }
      pendingMinimized.current.add(recipientDid);
      send({ type: 'dm_open', recipientDid });
    },
    [send],
  );

  const closeDm = useCallback(
    (conversationId: string) => {
      // Clean up timers
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

      // Close data channel peer
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

  const toggleMinimize = useCallback((conversationId: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.conversationId === conversationId
          ? { ...c, minimized: !c.minimized, unreadCount: c.minimized ? 0 : c.unreadCount }
          : c,
      ),
    );
  }, []);

  const sendDm = useCallback(
    (conversationId: string, text: string, facets?: unknown[], embed?: unknown) => {
      if (!did) return;
      const msg: DcTextMessage = {
        type: 'text',
        id: `local-${crypto.randomUUID()}`,
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

      // Optimistic local update
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

      // Close existing peer
      const peer = peersRef.current.get(conversationId);
      if (peer) {
        peer.close();
        peersRef.current.delete(conversationId);
      }

      // Clear connection timeout
      const ct = connectionTimers.current.get(conversationId);
      if (ct) {
        clearTimeout(ct);
        connectionTimers.current.delete(conversationId);
      }

      // Clear closing countdown
      const closing = closingTimers.current.get(conversationId);
      if (closing) {
        clearInterval(closing);
        closingTimers.current.delete(conversationId);
      }

      // Clear pending queues for stale connection
      pendingIceCandidates.current.delete(conversationId);

      // Reset state to connecting
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, peerState: 'connecting', closingIn: null }
            : c,
        ),
      );

      // Re-initiate
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
          // Clear matching notification
          setNotifications((prev) => prev.filter((n) => n.conversationId !== conversationId));

          const shouldMinimize = pendingMinimized.current.has(recipientDid);
          if (shouldMinimize) pendingMinimized.current.delete(recipientDid);

          setConversations((prev) => {
            if (prev.some((c) => c.conversationId === conversationId)) return prev;

            const newConvo: DmConversation = {
              conversationId,
              recipientDid,
              messages: [],
              minimized: shouldMinimize,
              typing: false,
              unreadCount: 0,
              peerState: 'connecting',
              closingIn: null,
            };

            const updated = [...prev, newConvo];
            // Auto-minimize oldest if over limit (browser popover mode only)
            if (!IS_TAURI && updated.filter((c) => !c.minimized).length > MAX_OPEN_POPOVERS) {
              const expandedIdx = updated.findIndex((c) => !c.minimized);
              const toMinimize = updated[expandedIdx];
              if (expandedIdx !== -1 && toMinimize) {
                updated[expandedIdx] = { ...toMinimize, minimized: true };
              }
            }
            return updated;
          });

          // Check if we have a pending offer for this conversation (receiver flow)
          const pending = pendingOffers.current.get(conversationId);
          if (pending) {
            pendingOffers.current.delete(conversationId);
            void acceptPeerConnection(conversationId, recipientDid, pending.offer);
          } else {
            // Initiator flow — create offer
            void initiatePeerConnection(conversationId, recipientDid);
          }

          // In Tauri mode, main window spawns a DM window
          if (IS_TAURI && !shouldMinimize) {
            void import('../lib/tauri-windows').then(({ openDmWindow, isMainWindow }) => {
              if (isMainWindow()) {
                void openDmWindow(conversationId, recipientDid);
              }
            });
          }
          break;
        }

        case 'im_offer': {
          const { conversationId, senderDid, offer } = msg.data;
          // Check if conversation is already open
          const convo = conversationsRef.current.find((c) => c.conversationId === conversationId);

          if (convo) {
            const existingPeer = peersRef.current.get(conversationId);

            // Glare: both peers sent im_offer simultaneously. Use DID comparison
            // to break the tie — lower DID is the "polite" peer that yields.
            if (existingPeer?.isCaller && existingPeer.state === 'connecting' && did) {
              const weArePolite = did < senderDid;
              if (!weArePolite) {
                // We're impolite — ignore incoming offer, wait for our answer
                break;
              }
              // We're polite — drop our offer, accept theirs
            }

            // Reconnection or polite-peer yield — accept the offer
            void acceptPeerConnection(conversationId, convo.recipientDid, offer);
          } else {
            // Buffer the offer, show notification
            pendingOffers.current.set(conversationId, { senderDid, offer });
            playImNotify();

            if (IS_TAURI) {
              // AIM behavior: auto-open a DM window for incoming IMs
              void import('../lib/tauri-windows').then(({ isMainWindow }) => {
                if (isMainWindow()) {
                  send({ type: 'dm_open', recipientDid: senderDid });
                }
              });
              // Native notification so user sees it even when minimized to tray
              void import('../lib/tauri-notifications').then(({ sendNativeNotification }) => {
                void sendNativeNotification(
                  'New Direct Message',
                  `${senderDid} sent you a message`,
                );
              });
            } else {
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
            // Buffer until peer is created
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

          // Cancel any closing countdown
          const closingTimer = closingTimers.current.get(conversationId);
          if (closingTimer) {
            clearInterval(closingTimer);
            closingTimers.current.delete(conversationId);
          }

          // Close existing peer
          const existingPeer = peersRef.current.get(conversationId);
          if (existingPeer) {
            existingPeer.close();
            peersRef.current.delete(conversationId);
          }

          // Clear stale state
          const ct = connectionTimers.current.get(conversationId);
          if (ct) {
            clearTimeout(ct);
            connectionTimers.current.delete(conversationId);
          }
          pendingIceCandidates.current.delete(conversationId);

          // Reset state and re-initiate
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

          // Close peer — no one to talk to
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

          // Start 10-second countdown
          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId
                ? { ...c, peerState: 'closed', closingIn: 10 }
                : c,
            ),
          );

          // Clear any existing closing timer
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
              // Auto-close the conversation
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

  // Clean up connection timers + closing timers + peers on unmount
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

  // Tauri: clean up stale conversations from child window IPC relay
  useEffect(() => {
    if (!IS_TAURI) return;
    const handler = (e: Event) => {
      const { conversationId } = (e as CustomEvent<{ conversationId: string }>).detail;
      const typingTimer = typingTimers.current.get(conversationId);
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimers.current.delete(conversationId);
      }
      lastTypingSent.current.delete(conversationId);

      // Close peer
      const peer = peersRef.current.get(conversationId);
      if (peer) {
        peer.close();
        peersRef.current.delete(conversationId);
      }
      pendingQueue.current.delete(conversationId);

      setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
      conversationsRef.current = conversationsRef.current.filter(
        (c) => c.conversationId !== conversationId,
      );
    };
    window.addEventListener('dm-child-close', handler);
    return () => {
      window.removeEventListener('dm-child-close', handler);
    };
  }, []);

  // Safety net: minimize conversations flagged via pendingMinimized
  useEffect(() => {
    if (pendingMinimized.current.size === 0) return;
    const toMinimize: string[] = [];
    for (const c of conversations) {
      if (pendingMinimized.current.has(c.recipientDid) && !c.minimized) {
        toMinimize.push(c.conversationId);
        pendingMinimized.current.delete(c.recipientDid);
      }
    }
    if (toMinimize.length > 0) {
      setConversations((prev) =>
        prev.map((c) => (toMinimize.includes(c.conversationId) ? { ...c, minimized: true } : c)),
      );
    }
  }, [conversations]);

  const value = useMemo<DmContextValue>(
    () => ({
      conversations,
      notifications,
      openDm,
      openDmMinimized,
      closeDm,
      toggleMinimize,
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
      openDmMinimized,
      closeDm,
      toggleMinimize,
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
