import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDmService, type DmService } from './service.js';
import type { Sql } from '../db/client.js';
import * as queries from './queries.js';

// Mock the queries module
vi.mock('./queries.js', async () => {
  const actual = await vi.importActual('./queries.js');
  return {
    ...actual,
    upsertConversation: vi.fn(),
    getConversation: vi.fn(),
    getDmMessages: vi.fn(),
    insertDmMessage: vi.fn(),
    setConversationPersist: vi.fn(),
    deleteConversation: vi.fn(),
    pruneExpiredDmMessages: vi.fn(),
    pruneEmptyConversations: vi.fn(),
  };
});

const mockSql = {} as Sql;

describe('DmService', () => {
  let service: DmService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createDmService(mockSql);
  });

  describe('openConversation', () => {
    it('creates conversation and returns empty messages when not persisted', async () => {
      const mockConvo = {
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(queries.upsertConversation).mockResolvedValue(mockConvo);

      const result = await service.openConversation('did:plc:bob', 'did:plc:alice');

      expect(result.conversation).toBe(mockConvo);
      expect(result.messages).toEqual([]);
      expect(queries.getDmMessages).not.toHaveBeenCalled();
    });

    it('loads history when persist is true', async () => {
      const mockConvo = {
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const mockMessages = [
        {
          id: 'msg1',
          conversation_id: 'abc123',
          sender_did: 'did:plc:alice',
          text: 'hello',
          created_at: new Date(),
        },
      ];
      vi.mocked(queries.upsertConversation).mockResolvedValue(mockConvo);
      vi.mocked(queries.getDmMessages).mockResolvedValue(mockMessages);

      const result = await service.openConversation('did:plc:alice', 'did:plc:bob');

      expect(result.messages).toBe(mockMessages);
      expect(queries.getDmMessages).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('inserts message and returns recipient DID', async () => {
      const mockConvo = {
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const mockMsg = {
        id: 'msg1',
        conversation_id: 'abc123',
        sender_did: 'did:plc:alice',
        text: 'hello',
        created_at: new Date(),
      };
      vi.mocked(queries.getConversation).mockResolvedValue(mockConvo);
      vi.mocked(queries.insertDmMessage).mockResolvedValue(mockMsg);

      const result = await service.sendMessage('abc123', 'did:plc:alice', 'hello');

      expect(result.message).toBe(mockMsg);
      expect(result.recipientDid).toBe('did:plc:bob');
    });

    it('throws when sender is not a participant', async () => {
      const mockConvo = {
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(queries.getConversation).mockResolvedValue(mockConvo);

      await expect(service.sendMessage('abc123', 'did:plc:eve', 'sneaky')).rejects.toThrow(
        'Not a participant',
      );
    });

    it('rejects messages blocked by content filter', async () => {
      const mockConvo = {
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(queries.getConversation).mockResolvedValue(mockConvo);

      // Character spam triggers filter
      await expect(
        service.sendMessage('abc123', 'did:plc:alice', 'aaaaaaaaaaaaaaaa'),
      ).rejects.toThrow('Character spam');
    });

    it('throws when conversation not found', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue(undefined);

      await expect(service.sendMessage('nonexistent', 'did:plc:alice', 'hello')).rejects.toThrow(
        'Conversation not found',
      );
    });
  });

  describe('isParticipant', () => {
    it('returns true for did_1', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(await service.isParticipant('abc123', 'did:plc:alice')).toBe(true);
    });

    it('returns true for did_2', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(await service.isParticipant('abc123', 'did:plc:bob')).toBe(true);
    });

    it('returns false for non-participant', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(await service.isParticipant('abc123', 'did:plc:eve')).toBe(false);
    });

    it('returns false when conversation not found', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue(undefined);

      expect(await service.isParticipant('nonexistent', 'did:plc:alice')).toBe(false);
    });
  });

  describe('cleanupIfEmpty', () => {
    it('deletes non-persist conversations', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.cleanupIfEmpty('abc123');

      expect(result).toBe(true);
      expect(queries.deleteConversation).toHaveBeenCalledWith(mockSql, 'abc123');
    });

    it('preserves persist conversations', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.cleanupIfEmpty('abc123');

      expect(result).toBe(false);
      expect(queries.deleteConversation).not.toHaveBeenCalled();
    });

    it('returns true when conversation not found', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue(undefined);

      const result = await service.cleanupIfEmpty('nonexistent');

      expect(result).toBe(true);
    });
  });

  describe('togglePersist', () => {
    it('updates persist flag for participant', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.togglePersist('abc123', 'did:plc:alice', true);

      expect(queries.setConversationPersist).toHaveBeenCalledWith(mockSql, 'abc123', true);
    });

    it('throws for non-participant', async () => {
      vi.mocked(queries.getConversation).mockResolvedValue({
        id: 'abc123',
        did_1: 'did:plc:alice',
        did_2: 'did:plc:bob',
        persist: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(service.togglePersist('abc123', 'did:plc:eve', true)).rejects.toThrow(
        'Not a participant',
      );
    });
  });
});
