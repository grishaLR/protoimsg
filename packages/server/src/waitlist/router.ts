import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import type { EmailService } from '../email/service.js';
import { createLogger } from '../logger.js';

const log = createLogger('waitlist');

const waitlistSchema = z.object({
  email: z.string().email(),
  handle: z.string().min(1),
});

export function waitlistRouter(sql: Sql, emailService: EmailService | null): Router {
  const router = Router();

  // POST / — join the waitlist
  router.post('/', async (req, res, next) => {
    try {
      const parsed = waitlistSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      const { email, handle } = parsed.data;

      // If this user was auto-inserted via a login attempt (has DID, no email),
      // update that row with their email. Otherwise insert new.
      const rows = await sql`
        INSERT INTO waitlist (email, handle, source)
        VALUES (${email}, ${handle}, 'web')
        ON CONFLICT (email) WHERE email IS NOT NULL DO NOTHING
        RETURNING id
      `;

      const isNew = rows.length > 0;

      if (isNew && emailService) {
        // Fire-and-forget — don't block the response on Resend API
        void emailService.sendWaitlistConfirmation(email, handle);
      }

      if (isNew) {
        log.info({ email, handle }, 'New waitlist signup');
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
