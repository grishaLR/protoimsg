import express, { Router } from 'express';
import { z } from 'zod';
import { ERROR_CODES, REPORT_CATEGORIES } from '@protoimsg/shared';
import { isValidDid } from '../auth/verify.js';
import { recordModAction } from '../moderation/queries.js';
import { createLogger } from '../logger.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import type { Sql } from '../db/client.js';
import type { EmailService } from '../email/service.js';

const log = createLogger('feedback');

const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const feedbackBodySchema = z.object({
  message: z.string().min(1).max(2000),
});

const reportBodySchema = z.object({
  subjectDid: z.string().refine(isValidDid, 'Invalid DID format'),
  category: z.enum(REPORT_CATEGORIES),
  description: z.string().max(1000).optional(),
  attachments: z
    .array(
      z
        .string()
        .max(3_500_000)
        .refine((s) => DATA_IMAGE_RE.test(s), 'Attachment must be a base64-encoded image'),
    )
    .max(2)
    .optional(),
});

const contentReportBodySchema = z.object({
  subjectUri: z.string().min(1).max(500).startsWith('at://'),
  roomId: z.string().optional(),
  category: z.enum(REPORT_CATEGORIES),
  description: z.string().max(1000).optional(),
  attachments: z
    .array(
      z
        .string()
        .max(3_500_000)
        .refine((s) => DATA_IMAGE_RE.test(s), 'Attachment must be a base64-encoded image'),
    )
    .max(2)
    .optional(),
});

function stripZodDetails(issues: z.ZodIssue[]): { path: (string | number)[]; message: string }[] {
  return issues.map((i) => ({ path: i.path, message: i.message }));
}

export function feedbackRouter(sql: Sql, emailService: EmailService | null): Router {
  const router = Router();

  // Per-endpoint rate limiters (stricter than global)
  const feedbackLimiter = new InMemoryRateLimiter({ windowMs: 3_600_000, maxRequests: 3 });
  const reportLimiter = new InMemoryRateLimiter({ windowMs: 3_600_000, maxRequests: 5 });

  // POST /feedback
  router.post('/', createRateLimitMiddleware(feedbackLimiter), async (req, res, next) => {
    try {
      const parsed = feedbackBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request body',
          errorCode: ERROR_CODES.INVALID_INPUT,
          details: stripZodDetails(parsed.error.issues),
        });
        return;
      }

      const did = req.did;
      const handle = req.handle;
      if (!did || !handle) {
        res.status(401).json({ error: 'Unauthorized', errorCode: ERROR_CODES.UNAUTHORIZED });
        return;
      }

      // Persist feedback to DB so it's never lost
      await recordModAction(sql, {
        roomId: null,
        actorDid: did,
        subjectDid: did,
        action: 'feedback',
        reason: parsed.data.message,
      });

      // Email is best-effort — don't fail the request if it errors
      if (emailService) {
        try {
          await emailService.sendFeedback(did, handle, parsed.data.message);
        } catch (err) {
          log.warn({ err, did }, 'Failed to send feedback email (persisted to DB)');
        }
      } else {
        log.warn({ did }, 'Feedback received but no email service configured');
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /report — needs larger body limit for base64 attachments
  router.post(
    '/report',
    express.json({ limit: '6mb' }),
    createRateLimitMiddleware(reportLimiter),
    async (req, res, next) => {
      try {
        const parsed = reportBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid request body',
            errorCode: ERROR_CODES.INVALID_INPUT,
            details: stripZodDetails(parsed.error.issues),
          });
          return;
        }

        const did = req.did;
        const handle = req.handle;
        if (!did || !handle) {
          res.status(401).json({ error: 'Unauthorized', errorCode: ERROR_CODES.UNAUTHORIZED });
          return;
        }

        const { subjectDid, category, description, attachments } = parsed.data;

        // Prevent self-reporting
        if (did === subjectDid) {
          res.status(400).json({
            error: 'Cannot report yourself',
            errorCode: ERROR_CODES.INVALID_INPUT,
          });
          return;
        }

        const reason = [category, description].filter(Boolean).join(': ');

        await recordModAction(sql, {
          roomId: null,
          actorDid: did,
          subjectDid,
          action: 'report',
          reason,
        });

        // Email is best-effort — don't fail the request if it errors
        if (emailService) {
          try {
            await emailService.sendReport(did, handle, {
              subjectDid,
              category,
              description,
              attachments,
            });
          } catch (err) {
            log.warn({ err, did, subjectDid }, 'Failed to send report email (persisted to DB)');
          }
        }

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /report-content — report a room or message
  router.post(
    '/report-content',
    express.json({ limit: '6mb' }),
    createRateLimitMiddleware(reportLimiter),
    async (req, res, next) => {
      try {
        const parsed = contentReportBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid request body',
            errorCode: ERROR_CODES.INVALID_INPUT,
            details: stripZodDetails(parsed.error.issues),
          });
          return;
        }

        const did = req.did;
        const handle = req.handle;
        if (!did || !handle) {
          res.status(401).json({ error: 'Unauthorized', errorCode: ERROR_CODES.UNAUTHORIZED });
          return;
        }

        const { subjectUri, roomId, category, description, attachments } = parsed.data;
        const reason = [category, description].filter(Boolean).join(': ');

        await recordModAction(sql, {
          roomId: roomId ?? null,
          actorDid: did,
          subjectDid: null,
          subjectUri,
          action: 'report',
          reason,
        });

        if (emailService) {
          try {
            await emailService.sendContentReport(did, handle, {
              subjectUri,
              roomId,
              category,
              description,
              attachments,
            });
          } catch (err) {
            log.warn(
              { err, did, subjectUri },
              'Failed to send content report email (persisted to DB)',
            );
          }
        }

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
