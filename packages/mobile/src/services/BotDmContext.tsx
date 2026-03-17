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
  fromBot: boolean;
  createdAt: string;
}

interface BotDmContextValue {
  isOpen: boolean;
  messages: BotDmMessage[];
  openBotDm: () => void;
  closeBotDm: () => void;
  sendMessage: (text: string) => void;
}

const BotDmContext = createContext<BotDmContextValue | null>(null);

let msgCounter = 0;
function nextId(prefix: string): string {
  msgCounter += 1;
  return `${prefix}-${Date.now()}-${msgCounter}`;
}

export function BotDmProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, connected } = useWebSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<BotDmMessage[]>([]);

  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const openBotDm = useCallback(() => {
    if (isOpenRef.current) return;
    setIsOpen(true);
    setMessages([]);
    send({ type: 'bot_dm_open' });
  }, [send]);

  const closeBotDm = useCallback(() => {
    send({ type: 'bot_dm_close' });
    setIsOpen(false);
    setMessages([]);
  }, [send]);

  const sendMessage = useCallback(
    (text: string) => {
      const userMsg: BotDmMessage = {
        id: nextId('local'),
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

  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'bot_dm_response') {
        const botMsg: BotDmMessage = {
          id: nextId('bot'),
          text: msg.data.text,
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

  useEffect(() => {
    if (!connected) {
      setIsOpen(false);
      setMessages([]);
    }
  }, [connected]);

  const value = useMemo<BotDmContextValue>(
    () => ({ isOpen, messages, openBotDm, closeBotDm, sendMessage }),
    [isOpen, messages, openBotDm, closeBotDm, sendMessage],
  );

  return <BotDmContext.Provider value={value}>{children}</BotDmContext.Provider>;
}

const NOOP_VALUE: BotDmContextValue = {
  isOpen: false,
  messages: [],
  openBotDm: () => {},
  closeBotDm: () => {},
  sendMessage: () => {},
};

export function useBotDm(): BotDmContextValue {
  const ctx = useContext(BotDmContext);
  return ctx ?? NOOP_VALUE;
}
