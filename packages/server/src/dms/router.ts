import { Router } from 'express';
import { LIMITS, ERROR_CODES } from '@protoimsg/shared';
import { listConversationsForDid, getDmMessages, getConversation } from './queries.js';
import type { Sql } from '../db/client.js';

export function dmRouter(sql: Sql): Router {
  const router = Router();

  // GET /api/dms — list conversations for the authenticated user
  router.get('/', async (req, res, next) => {
    try {
      const did = req.did ?? '';
      const rows = await listConversationsForDid(sql, did, {
        limit: Math.min(
          Math.max(Number(req.query.limit) || LIMITS.defaultPageSize, 1),
          LIMITS.maxPageSize,
        ),
        offset: Number(req.query.offset) || 0,
      });
      const conversations = rows.map((c) => ({
        id: c.id,
        did1: c.did_1,
        did2: c.did_2,
        persist: c.persist,
        createdAt: c.created_at.toISOString(),
        updatedAt: c.updated_at.toISOString(),
      }));
      res.json({ conversations });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/dms/:conversationId/messages — message history for a conversation
  router.get('/:conversationId/messages', async (req, res, next) => {
    try {
      const did = req.did ?? '';
      const { conversationId } = req.params;

      // Verify participant
      const conversation = await getConversation(sql, conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found', errorCode: ERROR_CODES.NOT_FOUND });
        return;
      }
      if (conversation.did_1 !== did && conversation.did_2 !== did) {
        res
          .status(403)
          .json({ error: 'Not a participant', errorCode: ERROR_CODES.NOT_PARTICIPANT });
        return;
      }

      const rows = await getDmMessages(sql, conversationId, {
        limit: Math.min(
          Math.max(Number(req.query.limit) || LIMITS.defaultPageSize, 1),
          LIMITS.maxPageSize,
        ),
        before: typeof req.query.before === 'string' ? req.query.before : undefined,
      });
      const messages = rows.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderDid: m.sender_did,
        text: m.text,
        createdAt: m.created_at.toISOString(),
      }));
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
