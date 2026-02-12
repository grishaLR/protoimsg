import { randomUUID } from 'node:crypto';
import { DM_LIMITS } from '@protoimsg/shared';
import { filterText } from '../moderation/filter.js';
import type { Sql } from '../db/client.js';
import { createLogger } from '../logger.js';

const log = createLogger('dms');
import {
  computeConversationId,
  sortDids,
  upsertConversation,
  getConversation,
  insertDmMessage,
  getDmMessages,
  setConversationPersist,
  deleteConversation,
  pruneExpiredDmMessages,
  pruneEmptyConversations,
  type DmConversationRow,
  type DmMessageRow,
} from './queries.js';

export interface OpenConversationResult {
  conversation: DmConversationRow;
  messages: DmMessageRow[];
}

export interface SendMessageResult {
  message: DmMessageRow;
  recipientDid: string;
}

export interface DmService {
  openConversation(senderDid: string, recipientDid: string): Promise<OpenConversationResult>;
  sendMessage(conversationId: string, senderDid: string, text: string): Promise<SendMessageResult>;
  togglePersist(conversationId: string, did: string, persist: boolean): Promise<void>;
  cleanupIfEmpty(conversationId: string): Promise<boolean>;
  pruneExpired(): Promise<void>;
  isParticipant(conversationId: string, did: string): Promise<boolean>;
  getRecipientDid(conversationId: string, senderDid: string): Promise<string | null>;
}

export function createDmService(sql: Sql): DmService {
  return {
    async openConversation(senderDid, recipientDid) {
      const [did1, did2] = sortDids(senderDid, recipientDid);
      const id = computeConversationId(senderDid, recipientDid);
      const conversation = await upsertConversation(sql, id, did1, did2);

      // Load history only if persist is enabled
      const messages = conversation.persist ? await getDmMessages(sql, id, { limit: 50 }) : [];

      return { conversation, messages };
    },

    async sendMessage(conversationId, senderDid, text) {
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) throw new Error('Conversation not found');

      if (conversation.did_1 !== senderDid && conversation.did_2 !== senderDid) {
        throw new Error('Not a participant');
      }

      if (text.length > DM_LIMITS.maxMessageLength) {
        throw new Error(`Message exceeds ${String(DM_LIMITS.maxMessageLength)} characters`);
      }

      const filter = filterText(text);
      if (!filter.passed) {
        throw new Error(filter.reason ?? 'Message blocked by content filter');
      }

      const message = await insertDmMessage(sql, {
        id: randomUUID(),
        conversationId,
        senderDid,
        text,
      });

      const recipientDid =
        conversation.did_1 === senderDid ? conversation.did_2 : conversation.did_1;

      return { message, recipientDid };
    },

    async togglePersist(conversationId, did, persist) {
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) throw new Error('Conversation not found');

      if (conversation.did_1 !== did && conversation.did_2 !== did) {
        throw new Error('Not a participant');
      }

      await setConversationPersist(sql, conversationId, persist);
    },

    async cleanupIfEmpty(conversationId) {
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) return true;

      // Only auto-delete non-persist conversations
      if (conversation.persist) return false;

      await deleteConversation(sql, conversationId);
      return true;
    },

    async pruneExpired() {
      const deleted = await pruneExpiredDmMessages(sql, DM_LIMITS.retentionDays);
      if (deleted > 0) {
        const pruned = await pruneEmptyConversations(sql);
        if (pruned > 0) {
          log.info({ count: pruned }, 'Pruned empty DM conversations');
        }
      }
    },

    async isParticipant(conversationId, did) {
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) return false;
      return conversation.did_1 === did || conversation.did_2 === did;
    },

    async getRecipientDid(conversationId, senderDid) {
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) return null;
      return conversation.did_1 === senderDid ? conversation.did_2 : conversation.did_1;
    },
  };
}
