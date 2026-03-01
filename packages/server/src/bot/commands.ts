import type { EmailService } from '../email/service.js';
import type { Sql } from '../db/client.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { filterText } from '../moderation/filter.js';
import { createLogger } from '../logger.js';
import {
  GREETING,
  UNKNOWN_COMMAND,
  RATE_LIMITED,
  FEEDBACK_SENT,
  REPORT_SENT,
  REPORT_UNAVAILABLE,
  FEEDBACK_UNAVAILABLE,
  REPORT_INVALID_FORMAT,
  FEEDBACK_EMPTY,
  RULES,
  HELP_INDEX,
  TOPIC_ALIASES,
  TOPICS,
  INFO_DM,
  roomInfo,
} from './responses.js';

const log = createLogger('bot');

export interface CommandResult {
  text: string;
}

export interface CommandContext {
  did: string;
  handle: string;
  emailService: EmailService | null;
  sql: Sql;
  commandRateLimiter: InMemoryRateLimiter;
  reportRateLimiter: InMemoryRateLimiter;
  feedbackRateLimiter: InMemoryRateLimiter;
}

export function getGreeting(): CommandResult {
  return { text: GREETING };
}

/** Parse and dispatch a command. Returns the bot's response text. */
export async function handleCommand(rawText: string, ctx: CommandContext): Promise<CommandResult> {
  // Content filter
  const filter = filterText(rawText);
  if (!filter.passed) {
    return { text: UNKNOWN_COMMAND };
  }

  // Global command rate limit (10/min per DID)
  const allowed = await ctx.commandRateLimiter.check(`bot:cmd:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED };
  }

  const text = rawText.trim();
  if (!text.startsWith('/')) {
    return { text: UNKNOWN_COMMAND };
  }

  const spaceIdx = text.indexOf(' ');
  const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  switch (command) {
    case '/help':
      return handleHelp(args);
    case '/rules':
      return { text: RULES };
    case '/info':
      return { text: INFO_DM };
    case '/report':
      return handleReport(args, ctx);
    case '/feedback':
      return handleFeedback(args, ctx);
    default:
      return { text: UNKNOWN_COMMAND };
  }
}

function handleHelp(args: string): CommandResult {
  if (!args) {
    return { text: HELP_INDEX };
  }

  const topicKey = TOPIC_ALIASES[args.toLowerCase()];
  if (!topicKey) {
    return { text: `Unknown topic "${args}". ${HELP_INDEX}` };
  }

  const content = TOPICS[topicKey];
  if (!content) {
    return { text: UNKNOWN_COMMAND };
  }

  return { text: content };
}

async function handleReport(args: string, ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.emailService) {
    return { text: REPORT_UNAVAILABLE };
  }

  // Parse: @handle [reason]
  const match = args.match(/^@(\S+)\s*(.*)/s);
  if (!match) {
    return { text: REPORT_INVALID_FORMAT };
  }

  const subjectHandle = match[1] as string;
  const reason = (match[2] ?? '').trim() || 'No reason provided';

  // Rate limit: 3/hour per DID
  const allowed = await ctx.reportRateLimiter.check(`bot:report:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED };
  }

  try {
    await ctx.emailService.sendReport(ctx.did, ctx.handle, {
      subjectDid: subjectHandle,
      subjectHandle,
      category: 'other',
      description: `[ProtoBuddy report] ${reason}`,
    });
    log.info({ reporter: ctx.did, subject: subjectHandle }, 'Bot report submitted');
    return { text: REPORT_SENT };
  } catch (err) {
    log.error({ err, reporter: ctx.did }, 'Bot report failed');
    return { text: REPORT_UNAVAILABLE };
  }
}

async function handleFeedback(args: string, ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.emailService) {
    return { text: FEEDBACK_UNAVAILABLE };
  }

  if (!args) {
    return { text: FEEDBACK_EMPTY };
  }

  // Rate limit: 5/hour per DID
  const allowed = await ctx.feedbackRateLimiter.check(`bot:feedback:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED };
  }

  try {
    await ctx.emailService.sendFeedback(ctx.did, ctx.handle, `[ProtoBuddy] ${args}`);
    log.info({ sender: ctx.did }, 'Bot feedback submitted');
    return { text: FEEDBACK_SENT };
  } catch (err) {
    log.error({ err, sender: ctx.did }, 'Bot feedback failed');
    return { text: FEEDBACK_UNAVAILABLE };
  }
}

/** Handle /sc commands from rooms. Returns null if not a valid bot command. */
export async function handleRoomCommand(
  rawText: string,
  ctx: CommandContext,
  roomId: string,
): Promise<CommandResult | null> {
  const text = rawText.trim();

  // Content filter
  const filter = filterText(text);
  if (!filter.passed) {
    return null;
  }

  // Global command rate limit
  const allowed = await ctx.commandRateLimiter.check(`bot:cmd:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED };
  }

  // Support both "/sc help" and "/sc /help" formats
  const commandText = text.startsWith('/') ? text : `/${text}`;
  const spaceIdx = commandText.indexOf(' ');
  const command = (spaceIdx === -1 ? commandText : commandText.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : commandText.slice(spaceIdx + 1).trim();

  switch (command) {
    case '/help':
      return handleHelp(args);
    case '/rules':
      return { text: RULES };
    case '/info':
      return handleRoomInfo(roomId, ctx.sql);
    case '/report':
      return handleReport(args, ctx);
    case '/feedback':
      return handleFeedback(args, ctx);
    default:
      return { text: UNKNOWN_COMMAND };
  }
}

async function handleRoomInfo(roomId: string, sql: Sql): Promise<CommandResult> {
  try {
    const rows = await sql<Array<{ name: string; topic: string | null }>>`
      SELECT name, topic FROM rooms WHERE id = ${roomId}
    `;
    const room = rows[0];
    if (!room) {
      return { text: 'Room not found.' };
    }
    return { text: roomInfo(room.name, room.topic) };
  } catch {
    return { text: INFO_DM };
  }
}
