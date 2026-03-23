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

// --- Conversational keyword matching ---
// Maps keyword patterns to topic keys or canned responses.
// Checked in order — first match wins. Patterns are tested against lowercased input.

interface ConversationMatch {
  patterns: RegExp[];
  response: string | (() => string);
  i18nKey: string;
}

const CONVERSATION_MATCHES: ConversationMatch[] = [
  {
    patterns: [/^(hey|hi|hello|yo|sup|what'?s up|howdy|hola|hii+)\b/],
    response:
      "Hey! What's up? Ask me anything about the app — video calls, privacy, buddy list, whatever.",
    i18nKey: 'bot:responses.chat.greeting',
  },
  {
    patterns: [/^(thanks|thank you|thx|ty|appreciate it)/],
    response: "Anytime! I'm always here if you need anything else.",
    i18nKey: 'bot:responses.chat.thanks',
  },
  {
    patterns: [
      /how are you/,
      /what are you/,
      /who are you/,
      /are you a bot/,
      /are you real/,
      /are you ai/,
    ],
    response:
      "I'm ProtoBuddy — your guide to protoimsg. Not AI, just a really well-informed bot. Think SmarterChild energy. Ask me about anything here.",
    i18nKey: 'bot:responses.chat.whoAreYou',
  },
  {
    patterns: [/how (do i|to|can i) (make|start|do) a (video )?call/, /call someone/, /video chat/],
    response: () => TOPICS['calls'] ?? '',
    i18nKey: 'bot:responses.topic.calls',
  },
  {
    patterns: [
      /group (call|video|chat)/,
      /start a meeting/,
      /how (do i|to) meet/,
      /meet(ing)? code/,
      /who can join/,
    ],
    response: () => TOPICS['groupcalls'] ?? '',
    i18nKey: 'bot:responses.topic.groupcalls',
  },
  {
    patterns: [
      /add (a |my )?(friend|buddy|person|someone|people)/,
      /how (do i|to) find (people|someone|friends)/,
    ],
    response: () => TOPICS['addbuddy'] ?? '',
    i18nKey: 'bot:responses.topic.addbuddy',
  },
  {
    patterns: [
      /is (this|it) private/,
      /who can see/,
      /privacy/,
      /are (my )?messages (private|encrypted|saved)/,
    ],
    response: () => TOPICS['privacy'] ?? '',
    i18nKey: 'bot:responses.topic.privacy',
  },
  {
    patterns: [
      /who (can )?see(s)? me/,
      /go invisible/,
      /hide (from|my)/,
      /visible to/,
      /ghost mode/,
    ],
    response: () => TOPICS['visibility'] ?? '',
    i18nKey: 'bot:responses.topic.visibility',
  },
  {
    patterns: [/set (my )?(status|away)/, /away message/, /how (do i|to) (go|set) away/],
    response: () => TOPICS['presence'] ?? '',
    i18nKey: 'bot:responses.topic.presence',
  },
  {
    patterns: [
      /change (the )?theme/,
      /dark mode/,
      /light mode/,
      /how (do i|to) change (the )?(look|color|style)/,
    ],
    response: () => TOPICS['themes'] ?? '',
    i18nKey: 'bot:responses.topic.themes',
  },
  {
    patterns: [/chat room/, /join a room/, /make a room/, /create a room/],
    response: () => TOPICS['rooms'] ?? '',
    i18nKey: 'bot:responses.topic.rooms',
  },
  {
    patterns: [/inner circle/, /trusted (people|friends)/, /trust tier/],
    response: () => TOPICS['innercircle'] ?? '',
    i18nKey: 'bot:responses.topic.innercircle',
  },
  {
    patterns: [
      /what is (this|protoimsg)/,
      /what (can|do) (i|you)/,
      /how does (this|it) work/,
      /what('s| is) this (app|place|thing)/,
    ],
    response: () => INFO_DM,
    i18nKey: 'bot:responses.info',
  },
  {
    patterns: [
      /block (someone|a user|them)/,
      /report (someone|a user|them)/,
      /someone (is )?being/,
      /harassment/,
    ],
    response: () => TOPICS['moderation'] ?? '',
    i18nKey: 'bot:responses.topic.moderation',
  },
  {
    patterns: [/send a gif/, /how (do i|to) (send |use )gif/],
    response: () => TOPICS['gifs'] ?? '',
    i18nKey: 'bot:responses.topic.gifs',
  },
  {
    patterns: [/translat/, /other language/, /speak (spanish|french|russian|arabic)/],
    response: () => TOPICS['translations'] ?? '',
    i18nKey: 'bot:responses.topic.translations',
  },
  {
    patterns: [
      /^(this is |pretty )?(cool|awesome|sick|dope|nice|amazing|love (this|it))/,
      /^(i )?(like|love) (this|it)/,
    ],
    response:
      "Glad you're vibing with it! If you've got ideas or feedback, hit me with /feedback [your thoughts].",
    i18nKey: 'bot:responses.chat.cool',
  },
  {
    patterns: [/move my account/, /switch (pds|server|provider)/, /portable/, /own my data/],
    response: () => TOPICS['portability'] ?? '',
    i18nKey: 'bot:responses.topic.portability',
  },
  {
    patterns: [/what are the rules/, /rules here/],
    response: () => RULES,
    i18nKey: 'bot:responses.rules',
  },
  {
    patterns: [/help/, /what can you (do|help with)/],
    response: () => HELP_INDEX,
    i18nKey: 'bot:responses.helpIndex',
  },
];

const log = createLogger('bot');

export interface CommandResult {
  text: string;
  i18nKey?: string;
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
  return { text: GREETING, i18nKey: 'bot:responses.greeting' };
}

/** Match freeform text against conversational keyword patterns. */
function matchConversation(text: string): CommandResult {
  const lower = text.toLowerCase();
  for (const match of CONVERSATION_MATCHES) {
    for (const pattern of match.patterns) {
      if (pattern.test(lower)) {
        const response = typeof match.response === 'function' ? match.response() : match.response;
        return { text: response, i18nKey: match.i18nKey };
      }
    }
  }
  return { text: UNKNOWN_COMMAND, i18nKey: 'bot:responses.unknownCommand' };
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
    return matchConversation(text);
  }

  const spaceIdx = text.indexOf(' ');
  const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  switch (command) {
    case '/help':
      return handleHelp(args);
    case '/rules':
      return { text: RULES, i18nKey: 'bot:responses.rules' };
    case '/info':
      return { text: INFO_DM, i18nKey: 'bot:responses.info' };
    case '/report':
      return handleReport(args, ctx);
    case '/feedback':
      return handleFeedback(args, ctx);
    default:
      return { text: UNKNOWN_COMMAND, i18nKey: 'bot:responses.unknownCommand' };
  }
}

function handleHelp(args: string): CommandResult {
  if (!args) {
    return { text: HELP_INDEX, i18nKey: 'bot:responses.helpIndex' };
  }

  const topicKey = TOPIC_ALIASES[args.toLowerCase()];
  if (!topicKey) {
    return { text: `Unknown topic "${args}". ${HELP_INDEX}` };
  }

  const content = TOPICS[topicKey];
  if (!content) {
    return { text: UNKNOWN_COMMAND, i18nKey: 'bot:responses.unknownCommand' };
  }

  return { text: content, i18nKey: `bot:responses.topic.${topicKey}` };
}

async function handleReport(args: string, ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.emailService) {
    return { text: REPORT_UNAVAILABLE, i18nKey: 'bot:responses.reportUnavailable' };
  }

  const match = args.match(/^@(\S+)\s*(.*)/s);
  if (!match) {
    return { text: REPORT_INVALID_FORMAT, i18nKey: 'bot:responses.reportInvalidFormat' };
  }

  const subjectHandle = match[1] as string;
  const reason = (match[2] ?? '').trim() || 'No reason provided';

  const allowed = await ctx.reportRateLimiter.check(`bot:report:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED, i18nKey: 'bot:responses.rateLimited' };
  }

  try {
    await ctx.emailService.sendReport(ctx.did, ctx.handle, {
      subjectDid: subjectHandle,
      subjectHandle,
      category: 'other',
      description: `[ProtoBuddy report] ${reason}`,
    });
    log.info({ reporter: ctx.did, subject: subjectHandle }, 'Bot report submitted');
    return { text: REPORT_SENT, i18nKey: 'bot:responses.reportSent' };
  } catch (err) {
    log.error({ err, reporter: ctx.did }, 'Bot report failed');
    return { text: REPORT_UNAVAILABLE, i18nKey: 'bot:responses.reportUnavailable' };
  }
}

async function handleFeedback(args: string, ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.emailService) {
    return { text: FEEDBACK_UNAVAILABLE, i18nKey: 'bot:responses.feedbackUnavailable' };
  }

  if (!args) {
    return { text: FEEDBACK_EMPTY, i18nKey: 'bot:responses.feedbackEmpty' };
  }

  const allowed = await ctx.feedbackRateLimiter.check(`bot:feedback:${ctx.did}`);
  if (!allowed) {
    return { text: RATE_LIMITED, i18nKey: 'bot:responses.rateLimited' };
  }

  try {
    await ctx.emailService.sendFeedback(ctx.did, ctx.handle, `[ProtoBuddy] ${args}`);
    log.info({ sender: ctx.did }, 'Bot feedback submitted');
    return { text: FEEDBACK_SENT, i18nKey: 'bot:responses.feedbackSent' };
  } catch (err) {
    log.error({ err, sender: ctx.did }, 'Bot feedback failed');
    return { text: FEEDBACK_UNAVAILABLE, i18nKey: 'bot:responses.feedbackUnavailable' };
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
