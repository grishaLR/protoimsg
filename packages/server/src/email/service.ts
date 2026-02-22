import { Resend } from 'resend';
import { createLogger } from '../logger.js';

const log = createLogger('email');

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class EmailService {
  private client: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async sendWaitlistConfirmation(to: string, handle?: string): Promise<void> {
    const greeting = handle ? `Hey @${escapeHtml(handle)}` : 'Hey';
    try {
      await this.client.emails.send({
        from: this.from,
        to,
        subject: "You're on the list — proto instant messenger",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin: 0 0 16px;">${greeting},</h2>
            <p style="line-height: 1.6; color: #333;">
              Thanks for signing up for <strong>proto instant messenger</strong>. We're adding people in waves to make sure everything runs smooth.
            </p>
            <p style="line-height: 1.6; color: #333;">
              We'll email you when it's your turn. Sit tight.
            </p>
            <p style="line-height: 1.6; color: #333;">
              If you have any questions, reach out to us on <a href="https://bsky.app/profile/protoimsg.myatproto.social" style="color: #6366f1;">Bluesky</a> or email <a href="mailto:protoimsg@gmail.com" style="color: #6366f1;">protoimsg@gmail.com</a>.
            </p>
            <p style="line-height: 1.6; color: #999; font-size: 14px; margin-top: 32px;">
              — the protoimsg team
            </p>
          </div>
        `,
      });
      log.info({ to }, 'Waitlist confirmation email sent');
    } catch (err) {
      log.error({ err, to }, 'Failed to send waitlist confirmation email');
    }
  }

  async sendApprovalNotification(to: string, handle?: string): Promise<void> {
    const greeting = handle ? `Hey @${escapeHtml(handle)}` : 'Hey';
    try {
      await this.client.emails.send({
        from: this.from,
        to,
        subject: "You're in — proto instant messenger",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin: 0 0 16px;">${greeting},</h2>
            <p style="line-height: 1.6; color: #333;">
              You've been approved for <strong>proto instant messenger</strong>. Sign in with your ATProto handle and you're good to go.
            </p>
            <p style="line-height: 1.6;">
              <a href="https://protoimsg.app" style="display: inline-block; background: #6366f1; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open protoimsg</a>
            </p>
            <p style="line-height: 1.6; color: #333;">
              Questions? Contact us on <a href="https://bsky.app/profile/protoimsg.myatproto.social" style="color: #6366f1;">Bluesky</a> or send an email to <a href="mailto:protoimsg@gmail.com" style="color: #6366f1;">protoimsg@gmail.com</a>.
            </p>
            <p style="line-height: 1.6; color: #999; font-size: 14px; margin-top: 32px;">
              — the protoimsg team
            </p>
          </div>
        `,
      });
      log.info({ to }, 'Approval notification email sent');
    } catch (err) {
      log.error({ err, to }, 'Failed to send approval notification email');
    }
  }
}
