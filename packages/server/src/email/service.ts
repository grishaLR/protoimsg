import { Resend } from 'resend';
import { createLogger } from '../logger.js';

const log = createLogger('email');

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Strip CR/LF to prevent email header injection in Subject lines. */
function sanitizeSubject(str: string): string {
  return str.replace(/[\r\n]/g, '');
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
              — the proto IM team
            </p>
          </div>
        `,
      });
      log.info({ to }, 'Waitlist confirmation email sent');
    } catch (err) {
      log.error({ err, to }, 'Failed to send waitlist confirmation email');
    }
  }

  async sendFeedback(fromDid: string, fromHandle: string, message: string): Promise<void> {
    const safeDid = escapeHtml(fromDid);
    const safeHandle = escapeHtml(fromHandle);
    const safeMessage = escapeHtml(message);

    try {
      await this.client.emails.send({
        from: this.from,
        to: 'protoimsg@gmail.com',
        subject: sanitizeSubject(`Feedback from @${fromHandle}`),
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin: 0 0 16px;">Feedback from @${safeHandle}</h2>
            <p style="line-height: 1.6; color: #666; font-size: 14px;">
              DID: ${safeDid}<br/>
              Handle: @${safeHandle}
            </p>
            <div style="line-height: 1.6; color: #333; white-space: pre-wrap; background: #f5f5f5; padding: 16px; border-radius: 8px;">
${safeMessage}
            </div>
          </div>
        `,
      });
      log.info({ fromDid }, 'Feedback email sent');
    } catch (err) {
      log.error({ err, fromDid }, 'Failed to send feedback email');
      throw err;
    }
  }

  async sendReport(
    fromDid: string,
    fromHandle: string,
    report: {
      subjectDid: string;
      subjectHandle?: string;
      category: string;
      description?: string;
      attachments?: string[];
    },
  ): Promise<void> {
    const safeReporterDid = escapeHtml(fromDid);
    const safeReporterHandle = escapeHtml(fromHandle);
    const safeSubjectDid = escapeHtml(report.subjectDid);
    const safeSubjectHandle = report.subjectHandle ? escapeHtml(report.subjectHandle) : 'unknown';
    const safeCategory = escapeHtml(report.category);
    const safeDescription = report.description ? escapeHtml(report.description) : '';

    // Attachments are already validated as data:image/...;base64,... by the router's Zod schema.
    // They only contain [A-Za-z0-9+/=:;,] characters, so escapeHtml is unnecessary and would be
    // wasteful on multi-MB strings.
    const attachmentHtml = (report.attachments ?? [])
      .map(
        (b64, i) =>
          `<div style="margin-top: 16px;"><p style="color: #666; font-size: 12px;">Attachment ${i + 1}</p><img src="${b64}" style="max-width: 100%; border-radius: 8px;" /></div>`,
      )
      .join('');

    try {
      await this.client.emails.send({
        from: this.from,
        to: 'protoimsg@gmail.com',
        subject: sanitizeSubject(`User Report — @${report.subjectHandle ?? 'unknown'}`),
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin: 0 0 16px;">User Report</h2>
            <table style="font-size: 14px; line-height: 1.6; color: #333;">
              <tr><td style="padding-right: 12px; color: #666;">Reporter</td><td>@${safeReporterHandle} (${safeReporterDid})</td></tr>
              <tr><td style="padding-right: 12px; color: #666;">Subject</td><td>@${safeSubjectHandle} (${safeSubjectDid})</td></tr>
              <tr><td style="padding-right: 12px; color: #666;">Category</td><td>${safeCategory}</td></tr>
            </table>
            ${safeDescription ? `<div style="margin-top: 16px; line-height: 1.6; color: #333; white-space: pre-wrap; background: #f5f5f5; padding: 16px; border-radius: 8px;">${safeDescription}</div>` : ''}
            ${attachmentHtml}
          </div>
        `,
      });
      log.info({ fromDid, subjectDid: report.subjectDid }, 'Report email sent');
    } catch (err) {
      log.error({ err, fromDid, subjectDid: report.subjectDid }, 'Failed to send report email');
      throw err;
    }
  }

  async sendContentReport(
    fromDid: string,
    fromHandle: string,
    report: {
      subjectUri: string;
      roomId?: string;
      category: string;
      description?: string;
      attachments?: string[];
    },
  ): Promise<void> {
    const safeReporterDid = escapeHtml(fromDid);
    const safeReporterHandle = escapeHtml(fromHandle);
    const safeUri = escapeHtml(report.subjectUri);
    const safeRoomId = report.roomId ? escapeHtml(report.roomId) : null;
    const safeCategory = escapeHtml(report.category);
    const safeDescription = report.description ? escapeHtml(report.description) : '';

    const attachmentHtml = (report.attachments ?? [])
      .map(
        (b64, i) =>
          `<div style="margin-top: 16px;"><p style="color: #666; font-size: 12px;">Attachment ${i + 1}</p><img src="${b64}" style="max-width: 100%; border-radius: 8px;" /></div>`,
      )
      .join('');

    try {
      await this.client.emails.send({
        from: this.from,
        to: 'protoimsg@gmail.com',
        subject: sanitizeSubject(`Content Report — ${report.subjectUri.slice(0, 60)}`),
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin: 0 0 16px;">Content Report</h2>
            <table style="font-size: 14px; line-height: 1.6; color: #333;">
              <tr><td style="padding-right: 12px; color: #666;">Reporter</td><td>@${safeReporterHandle} (${safeReporterDid})</td></tr>
              <tr><td style="padding-right: 12px; color: #666;">Subject URI</td><td>${safeUri}</td></tr>
              ${safeRoomId ? `<tr><td style="padding-right: 12px; color: #666;">Room</td><td>${safeRoomId}</td></tr>` : ''}
              <tr><td style="padding-right: 12px; color: #666;">Category</td><td>${safeCategory}</td></tr>
            </table>
            ${safeDescription ? `<div style="margin-top: 16px; line-height: 1.6; color: #333; white-space: pre-wrap; background: #f5f5f5; padding: 16px; border-radius: 8px;">${safeDescription}</div>` : ''}
            ${attachmentHtml}
          </div>
        `,
      });
      log.info({ fromDid, subjectUri: report.subjectUri }, 'Content report email sent');
    } catch (err) {
      log.error(
        { err, fromDid, subjectUri: report.subjectUri },
        'Failed to send content report email',
      );
      throw err;
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
              You're off the waitlist. Your account is active.
            </p>
            <p style="line-height: 1.6; color: #333;">
              Sign in at <a href="https://protoimsg.app" style="color: #6366f1;">protoimsg.app</a> with your AT Protocol handle to get started.
            </p>
            <p style="line-height: 1.6; color: #333;">
              This is an early beta — things might break. If something's off, reach out on
              <a href="https://bsky.app/profile/protoimsg.myatproto.social" style="color: #6366f1;">Bluesky</a> or
              email <a href="mailto:protoimsg@gmail.com" style="color: #6366f1;">protoimsg@gmail.com</a>.
              Your feedback helps shape a platform built to protect your privacy and keep you connected peer-to-peer and on your terms.

            </p>
            <p style="line-height: 1.6; color: #333;">
              See you in the rooms.
            </p>
            <p style="line-height: 1.6; color: #999; font-size: 14px; margin-top: 32px;">
              — the proto IM team
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
