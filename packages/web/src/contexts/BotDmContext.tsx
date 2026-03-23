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
import type { ServerMessage } from '@protoimsg/shared';

const MAX_MESSAGES = 100;

export interface BotDmMessage {
  id: string;
  text: string;
  i18nKey?: string;
  fromBot: boolean;
  createdAt: string;
}

interface BotDmContextValue {
  isOpen: boolean;
  messages: BotDmMessage[];
  minimized: boolean;
  openBotDm: () => void;
  closeBotDm: () => void;
  sendMessage: (text: string) => void;
  toggleMinimize: () => void;
}

const BotDmContext = createContext<BotDmContextValue | null>(null);

export function BotDmProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, connected } = useWebSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<BotDmMessage[]>([]);
  const [minimized, setMinimized] = useState(false);

  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const openBotDm = useCallback(() => {
    if (isOpenRef.current) {
      setMinimized(false);
      return;
    }
    setIsOpen(true);
    setMinimized(false);
    setMessages([]);
    send({ type: 'bot_dm_open' });
  }, [send]);

  const closeBotDm = useCallback(() => {
    send({ type: 'bot_dm_close' });
    setIsOpen(false);
    setMessages([]);
    setMinimized(false);
  }, [send]);

  const sendMessage = useCallback(
    (text: string) => {
      const userMsg: BotDmMessage = {
        id: `local-${crypto.randomUUID()}`,
        text,
        fromBot: false,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => {
        const updated = [...prev, userMsg];
        return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
      });
      send({ type: 'bot_dm_send', text });
    },
    [send],
  );

  const toggleMinimize = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  // Auto-open on first login for onboarding
  const hasOnboarded = useRef(false);
  useEffect(() => {
    if (!connected || hasOnboarded.current) return;
    hasOnboarded.current = true;
    const key = 'protoimsg:bot-onboarded';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      const timer = setTimeout(() => {
        openBotDm();
      }, 1500);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [connected, openBotDm]);

  // Subscribe to bot_dm_response events
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'bot_dm_response') {
        const botMsg: BotDmMessage = {
          id: `bot-${crypto.randomUUID()}`,
          text: msg.data.text,
          i18nKey: msg.data.i18nKey,
          fromBot: true,
          createdAt: msg.data.createdAt,
        };
        setMessages((prev) => {
          const updated = [...prev, botMsg];
          return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
        });
      }
    });
    return unsub;
  }, [subscribe]);

  // Reset state on WS disconnect
  useEffect(() => {
    if (!connected) {
      setIsOpen(false);
      setMessages([]);
      setMinimized(false);
    }
  }, [connected]);

  const value = useMemo<BotDmContextValue>(
    () => ({
      isOpen,
      messages,
      minimized,
      openBotDm,
      closeBotDm,
      sendMessage,
      toggleMinimize,
    }),
    [isOpen, messages, minimized, openBotDm, closeBotDm, sendMessage, toggleMinimize],
  );

  return <BotDmContext.Provider value={value}>{children}</BotDmContext.Provider>;
}

const NOOP_VALUE: BotDmContextValue = {
  isOpen: false,
  messages: [],
  minimized: false,
  openBotDm: () => {},
  closeBotDm: () => {},
  sendMessage: () => {},
  toggleMinimize: () => {},
};

export function useBotDm(): BotDmContextValue {
  const ctx = useContext(BotDmContext);
  return ctx ?? NOOP_VALUE;
}
