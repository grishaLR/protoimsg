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
import { playImNotify } from '../lib/sounds';
import type { ServerMessage } from '@protoimsg/shared';

const MAX_TOASTS = 5;
const TOAST_DISMISS_MS = 5_000;

export interface MentionNotification {
  id: string;
  roomId: string;
  roomName: string;
  senderDid: string;
  messageText: string;
  messageUri: string;
  createdAt: string;
}

interface MentionNotificationContextValue {
  toasts: MentionNotification[];
  unreadMentions: Record<string, number>;
  dismissToast: (id: string) => void;
  clearMentions: (roomId: string) => void;
}

const MentionNotificationContext = createContext<MentionNotificationContextValue | null>(null);

/** Request browser notification permission lazily on first mention. */
let permissionRequested = false;
function ensureNotificationPermission(): void {
  if (permissionRequested || typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    permissionRequested = true;
    void Notification.requestPermission();
  }
}

function showBrowserNotification(n: MentionNotification): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  const body = n.messageText.length > 80 ? n.messageText.slice(0, 80) + '...' : n.messageText;
  new Notification(`Mentioned in ${n.roomName}`, { body, tag: n.messageUri });
}

export function MentionNotificationProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const [toasts, setToasts] = useState<MentionNotification[]>([]);
  const [unreadMentions, setUnreadMentions] = useState<Record<string, number>>({});
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const clearMentions = useCallback((roomId: string) => {
    setUnreadMentions((prev) => {
      if (!prev[roomId]) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== roomId));
    });
  }, []);

  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type !== 'mention_notification') return;

      const { roomId, roomName, senderDid, messageText, messageUri, createdAt } = msg.data;
      const id = `mention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const notification: MentionNotification = {
        id,
        roomId,
        roomName,
        senderDid,
        messageText,
        messageUri,
        createdAt,
      };

      playImNotify();

      // Browser notification
      ensureNotificationPermission();
      showBrowserNotification(notification);

      // Add toast (cap at MAX_TOASTS)
      setToasts((prev) => {
        const next = [...prev, notification];
        return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
      });

      // Auto-dismiss timer
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, TOAST_DISMISS_MS);
      timers.current.set(id, timer);

      // Increment unread count
      setUnreadMentions((prev) => ({
        ...prev,
        [roomId]: (prev[roomId] ?? 0) + 1,
      }));
    });

    return () => {
      unsub();
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, [subscribe]);

  const value = useMemo<MentionNotificationContextValue>(
    () => ({ toasts, unreadMentions, dismissToast, clearMentions }),
    [toasts, unreadMentions, dismissToast, clearMentions],
  );

  return (
    <MentionNotificationContext.Provider value={value}>
      {children}
    </MentionNotificationContext.Provider>
  );
}

export function useMentionNotifications(): MentionNotificationContextValue {
  const ctx = useContext(MentionNotificationContext);
  if (!ctx)
    throw new Error('useMentionNotifications must be used within MentionNotificationProvider');
  return ctx;
}
