import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { USER_AGENT } from '@protoimsg/shared';
import type { GlobalAllowlistService } from '../moderation/global-allowlist-service.js';
import type { EmailService } from '../email/service.js';
import { setRoomHidden } from '../rooms/queries.js';
import { createLogger } from '../logger.js';

const log = createLogger('admin');

const approveSchema = z.object({
  handle: z.string().min(1),
  reason: z.string().optional(),
});

export function adminRouter(
  sql: Sql,
  globalAllowlist: GlobalAllowlistService,
  adminApiKey: string,
  publicApiUrl: string,
  emailService: EmailService | null,
  firehoseFailover?: () => void,
): Router {
  const router = Router();

  // API key auth middleware (timing-safe comparison)
  router.use((req, res, next) => {
    const key = req.headers['x-admin-key'] ?? req.headers.authorization?.replace('Bearer ', '');
    if (
      typeof key !== 'string' ||
      key.length !== adminApiKey.length ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(adminApiKey))
    ) {
      res.status(401).json({ error: 'Invalid admin key' });
      return;
    }
    next();
  });

  // GET / — list pending waitlist entries
  router.get('/waitlist', async (_req, res, next) => {
    try {
      const rows = await sql`
        SELECT id, email, handle, status, created_at, approved_at
        FROM waitlist
        ORDER BY
          CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
          created_at ASC
      `;
      res.json({ entries: rows });
    } catch (err) {
      next(err);
    }
  });

  // POST /approve — approve a waitlist entry by handle
  router.post('/approve', async (req, res, next) => {
    try {
      const parsed = approveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      const { handle, reason } = parsed.data;

      // Resolve handle → DID via public ATProto API
      const resolveUrl = `${publicApiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
      const resolveRes = await fetch(resolveUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!resolveRes.ok) {
        res.status(404).json({ error: `Could not resolve handle: ${handle}` });
        return;
      }
      const { did } = (await resolveRes.json()) as { did: string };

      // Add to global allowlist
      await globalAllowlist.add(sql, did, handle, reason ?? 'beta-approve', 'admin');

      // Update waitlist entry (match by handle since email→DID isn't reliable)
      const updated = await sql`
        UPDATE waitlist
        SET did = ${did}, status = 'approved', approved_at = NOW()
        WHERE handle = ${handle} AND status = 'pending'
        RETURNING email, handle
      `;

      // Send approval notification if we found a waitlist entry with email
      const entry = updated[0] as { email?: string; handle?: string } | undefined;
      if (entry?.email && emailService) {
        void emailService.sendApprovalNotification(entry.email, entry.handle);
      }

      log.info({ did, handle }, 'Waitlist entry approved');
      res.json({
        success: true,
        did,
        handle,
        waitlistUpdated: updated.length > 0,
        emailSent: !!entry?.email && !!emailService,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/hide — hide a room from the directory
  router.post('/rooms/:id/hide', async (req, res, next) => {
    try {
      const updated = await setRoomHidden(sql, req.params.id, true);
      if (!updated) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      log.info({ roomId: req.params.id }, 'Room hidden by admin');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /rooms/:id/unhide — unhide a room
  router.post('/rooms/:id/unhide', async (req, res, next) => {
    try {
      const updated = await setRoomHidden(sql, req.params.id, false);
      if (!updated) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      log.info({ roomId: req.params.id }, 'Room unhidden by admin');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /reports — list recent reports
  router.get('/reports', async (_req, res, next) => {
    try {
      const rows = await sql`
        SELECT * FROM mod_actions
        WHERE action = 'report'
        ORDER BY created_at DESC
        LIMIT 50
      `;
      res.json({ reports: rows });
    } catch (err) {
      next(err);
    }
  });

  // POST /firehose/failover — force Jetstream failover to next instance
  if (firehoseFailover) {
    router.post('/firehose/failover', (_req, res) => {
      log.info('Admin-triggered Jetstream failover');
      firehoseFailover();
      res.json({ success: true, message: 'Failover triggered' });
    });
  }

  return router;
}
