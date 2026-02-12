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
import { IS_TAURI } from '../lib/config';
import type { DmMessageView } from '../types';
import type { ServerMessage } from '@protoimsg/shared';

const MAX_OPEN_POPOVERS = 4;
const MAX_MESSAGES = 200;
const MAX_NOTIFICATIONS = 20;
const PENDING_TIMEOUT_MS = 15_000;

export interface DmConversation {
  conversationId: string;
  recipientDid: string;
  messages: DmMessageView[];
  persist: boolean;
  minimized: boolean;
  typing: boolean;
  unreadCount: number;
}

export interface DmNotification {
  conversationId: string;
  senderDid: string;
  preview: string;
  receivedAt: string;
}

interface DmContextValue {
  conversations: DmConversation[];
  notifications: DmNotification[];
  openDm: (recipientDid: string) => void;
  openDmMinimized: (recipientDid: string) => void;
  closeDm: (conversationId: string) => void;
  toggleMinimize: (conversationId: string) => void;
  sendDm: (conversationId: string, text: string) => void;
  sendTyping: (conversationId: string) => void;
  togglePersist: (conversationId: string, persist: boolean) => void;
  dismissNotification: (conversationId: string) => void;
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
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // M24: pendingMinimized — ref to track "open minimized" intent across async boundary.
  // When openDmMinimized(recipientDid) is called before the server responds, we can't
  // add the conversation to state yet. We store recipientDid here; when dm_opened
  // arrives, we read it and set minimized: true on the new conversation.
  const pendingMinimized = useRef<Set<string>>(new Set());

  // M24: conversationsRef — ref mirror of conversations state. Callbacks like openDm,
  // openDmMinimized, and the dm_incoming handler need the latest conversations
  // without being recreated when conversations changes (which would cause stale
  // closures in subscriptions). We read conversationsRef.current inside callbacks
  // instead of closing over conversations.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

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
        // Already open — ensure minimized
        setConversations((prev) =>
          prev.map((c) =>
            c.conversationId === existing.conversationId ? { ...c, minimized: true } : c,
          ),
        );
        return;
      }
      // Not yet open — mark for minimized state when dm_opened arrives
      pendingMinimized.current.add(recipientDid);
      send({ type: 'dm_open', recipientDid });
    },
    [send],
  );

  const closeDm = useCallback(
    (conversationId: string) => {
      // Clean up timers for this conversation (M6)
      const typingTimer = typingTimers.current.get(conversationId);
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimers.current.delete(conversationId);
      }
      lastTypingSent.current.delete(conversationId);

      send({ type: 'dm_close', conversationId });
      setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
      // Eagerly update ref so a subsequent openDm() in the same tick won't
      // find the just-closed conversation and skip the server request.
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
    (conversationId: string, text: string) => {
      if (!did) return; // Guard against unauthenticated sends (M4 from context audit)
      send({ type: 'dm_send', conversationId, text });

      const pendingId = `pending-${crypto.randomUUID()}`;
      const pendingMsg: DmMessageView = {
        id: pendingId,
        conversationId,
        senderDid: did,
        text,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversationId
            ? { ...c, messages: trimMessages([...c.messages, pendingMsg]) }
            : c,
        ),
      );

      // H5: Timeout pending messages — mark as failed after 15s
      const timer = setTimeout(() => {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.conversationId !== conversationId) return c;
            return {
              ...c,
              messages: c.messages.filter((m) => m.id !== pendingId),
            };
          }),
        );
        pendingTimers.current.delete(pendingId);
      }, PENDING_TIMEOUT_MS);
      pendingTimers.current.set(pendingId, timer);
    },
    [send, did],
  );

  const sendTyping = useCallback(
    (conversationId: string) => {
      const now = Date.now();
      const last = lastTypingSent.current.get(conversationId) ?? 0;
      if (now - last < 3000) return;
      lastTypingSent.current.set(conversationId, now);
      send({ type: 'dm_typing', conversationId });
    },
    [send],
  );

  const togglePersist = useCallback(
    (conversationId: string, persist: boolean) => {
      send({ type: 'dm_toggle_persist', conversationId, persist });
    },
    [send],
  );

  const dismissNotification = useCallback((conversationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.conversationId !== conversationId));
  }, []);

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
          const { conversationId, recipientDid, persist, messages } = msg.data;
          // Clear matching notification (safe — separate state, not inside updater)
          setNotifications((prev) => prev.filter((n) => n.conversationId !== conversationId));

          const shouldMinimize = pendingMinimized.current.has(recipientDid);
          if (shouldMinimize) pendingMinimized.current.delete(recipientDid);

          setConversations((prev) => {
            if (prev.some((c) => c.conversationId === conversationId)) return prev;

            const newConvo: DmConversation = {
              conversationId,
              recipientDid,
              messages: [...messages].reverse().map((m) => ({
                id: m.id,
                conversationId: m.conversationId,
                senderDid: m.senderDid,
                text: m.text,
                createdAt: m.createdAt,
              })),
              persist,
              minimized: shouldMinimize,
              typing: false,
              unreadCount: 0,
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

          // In Tauri mode, main window spawns a DM window (child windows skip this)
          if (IS_TAURI && !shouldMinimize) {
            void import('../lib/tauri-windows').then(({ openDmWindow, isMainWindow }) => {
              if (isMainWindow()) {
                void openDmWindow(conversationId, recipientDid);
              }
            });
          }
          break;
        }

        case 'dm_message': {
          const dmMsg = msg.data;
          // C3: Check if sound is needed before the state update, using ref
          const convo = conversationsRef.current.find(
            (c) => c.conversationId === dmMsg.conversationId,
          );
          if (convo?.minimized && dmMsg.senderDid !== did) {
            playImNotify();
          }

          setConversations((prev) =>
            prev.map((c) => {
              if (c.conversationId !== dmMsg.conversationId) return c;

              // L2: Dedup by message ID
              if (c.messages.some((m) => m.id === dmMsg.id)) return c;

              const confirmedMsg: DmMessageView = {
                id: dmMsg.id,
                conversationId: dmMsg.conversationId,
                senderDid: dmMsg.senderDid,
                text: dmMsg.text,
                createdAt: dmMsg.createdAt,
              };

              let newMessages: DmMessageView[];
              // L1: Dedup own pending messages — replace oldest pending
              if (dmMsg.senderDid === did) {
                const pendingIdx = c.messages.findIndex((m) => m.pending && m.senderDid === did);
                if (pendingIdx !== -1) {
                  const pendingMsg = c.messages[pendingIdx];
                  // Clear pending timeout
                  if (pendingMsg) {
                    const timer = pendingTimers.current.get(pendingMsg.id);
                    if (timer) {
                      clearTimeout(timer);
                      pendingTimers.current.delete(pendingMsg.id);
                    }
                  }
                  newMessages = [...c.messages];
                  newMessages[pendingIdx] = confirmedMsg;
                } else {
                  newMessages = [...c.messages, confirmedMsg];
                }
              } else {
                newMessages = [...c.messages, confirmedMsg];
              }

              // H4: Cap messages
              newMessages = trimMessages(newMessages);

              const isMinimized = c.minimized;
              return {
                ...c,
                messages: newMessages,
                unreadCount:
                  isMinimized && dmMsg.senderDid !== did ? c.unreadCount + 1 : c.unreadCount,
              };
            }),
          );
          break;
        }

        case 'dm_typing': {
          const { conversationId, senderDid } = msg.data;
          if (senderDid === did) break;

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
          break;
        }

        case 'dm_persist_changed': {
          const { conversationId, persist } = msg.data;
          setConversations((prev) =>
            prev.map((c) => (c.conversationId === conversationId ? { ...c, persist } : c)),
          );
          break;
        }

        case 'dm_incoming': {
          const { conversationId, senderDid, preview } = msg.data;
          // C3: Read conversations via ref, don't abuse setConversations as a reader
          const alreadyOpen = conversationsRef.current.some(
            (c) => c.conversationId === conversationId,
          );
          if (!alreadyOpen) {
            playImNotify();

            if (IS_TAURI) {
              // AIM behavior: auto-open a DM window for incoming messages.
              // Sends dm_open → server responds dm_opened → window spawns.
              void import('../lib/tauri-windows').then(({ isMainWindow }) => {
                if (isMainWindow()) {
                  send({ type: 'dm_open', recipientDid: senderDid });
                }
              });
            } else {
              setNotifications((n) => {
                if (n.some((x) => x.conversationId === conversationId)) return n;
                // L4: Cap notifications
                const updated = [
                  ...n,
                  {
                    conversationId,
                    senderDid,
                    preview,
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
      }
    });

    return () => {
      unsub();
      for (const timer of typingTimers.current.values()) {
        clearTimeout(timer);
      }
      typingTimers.current.clear();
    };
  }, [subscribe, did]);

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of pendingTimers.current.values()) {
        clearTimeout(timer);
      }
      pendingTimers.current.clear();
    };
  }, []);

  // Tauri: when a DM child window sends dm_close through the IPC relay,
  // the main window's DmContext doesn't hear about it (only the child's
  // DmContext called closeDm). The relay dispatches a DOM event so we can
  // clean up the stale conversation entry here.
  useEffect(() => {
    if (!IS_TAURI) return;
    const handler = (e: Event) => {
      const { conversationId } = (e as CustomEvent<{ conversationId: string }>).detail;
      // Clean up timers
      const typingTimer = typingTimers.current.get(conversationId);
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimers.current.delete(conversationId);
      }
      lastTypingSent.current.delete(conversationId);
      // Remove from state + eagerly update ref
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

  // Safety net: if dm_opened handler didn't catch the pendingMinimized flag,
  // minimize the conversation reactively when it appears in state
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

  // M1: Memoize context value to prevent unnecessary consumer re-renders
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
      togglePersist,
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
      togglePersist,
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
