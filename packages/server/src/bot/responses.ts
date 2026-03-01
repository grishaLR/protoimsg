/** Scripted response text for ProtoBuddy bot — SmarterChild energy. */

export const GREETING =
  "Hey! I'm ProtoBuddy. Think of me as the friend who knows where everything is. Type /help to see what I've got.";

export const UNKNOWN_COMMAND =
  'Hmm, not sure about that one. Try /help to see what I can help with — themes, privacy, video calls, all that good stuff.';

export const RATE_LIMITED = 'Easy there! Give me a sec and try again.';

export const FEEDBACK_SENT = 'Sent! The team will see it. Thanks for taking the time.';

export const REPORT_SENT = "Report's in. The team will look into it.";

export const REPORT_UNAVAILABLE = 'Reports are down right now. Try again in a bit?';

export const FEEDBACK_UNAVAILABLE = "Feedback's down right now. Try again later?";

export const REPORT_INVALID_FORMAT =
  'Try: /report @handle reason\nLike: /report @spammer.bsky.social Flooding the room with ads';

export const FEEDBACK_EMPTY = "What's on your mind? Try: /feedback [your message]";

export const RULES = `Quick version of the house rules:

Be cool to people. No harassment, hate speech, or targeted abuse.
Keep private stuff private. Don't share others' info.
No spam. Bots and flooding = ban.
Nothing illegal. No threats, no doxxing.
Room mods make the rules in their rooms.
See something? /report it. Don't start a thing.

Full terms at protoimsg.app/terms`;

export const HELP_INDEX = `Here's what I know about:

/help ims — How IMs work
/help privacy — What's public vs private
/help rooms — Chat rooms
/help community — Your buddy list
/help innercircle — Your trusted people
/help presence — Status & away messages
/help visibility — Who sees you online
/help calls — Video calls
/help moderation — Blocking & reporting
/help themes — Theme picker
/help translations — Language support
/help gifs — GIF commands
/help polls — Polls
/help threads — Threaded replies
/help richtext — Text formatting
/help portability — Account portability
/help feed — Feed view
/help createroom — Making a room
/help addbuddy — Adding people

Also: /rules, /report @user reason, /feedback message, /info`;

/** Topic alias map — maps all aliases to canonical topic key */
export const TOPIC_ALIASES: Record<string, string> = {
  ims: 'ims',
  im: 'ims',
  dms: 'ims',
  dm: 'ims',
  privacy: 'privacy',
  private: 'privacy',
  public: 'privacy',
  themes: 'themes',
  theme: 'themes',
  translations: 'translations',
  translate: 'translations',
  languages: 'translations',
  visibility: 'visibility',
  visible: 'visibility',
  invisible: 'visibility',
  rooms: 'rooms',
  room: 'rooms',
  chatrooms: 'rooms',
  community: 'community',
  buddylist: 'community',
  buddies: 'community',
  innercircle: 'innercircle',
  ic: 'innercircle',
  inner: 'innercircle',
  presence: 'presence',
  away: 'presence',
  status: 'presence',
  online: 'presence',
  calls: 'calls',
  call: 'calls',
  video: 'calls',
  videocall: 'calls',
  moderation: 'moderation',
  mod: 'moderation',
  block: 'moderation',
  report: 'moderation',
  ban: 'moderation',
  gifs: 'gifs',
  gif: 'gifs',
  giphy: 'gifs',
  klipy: 'gifs',
  polls: 'polls',
  poll: 'polls',
  threads: 'threads',
  thread: 'threads',
  replies: 'threads',
  reply: 'threads',
  richtext: 'richtext',
  formatting: 'richtext',
  format: 'richtext',
  portability: 'portability',
  pds: 'portability',
  migrate: 'portability',
  identity: 'portability',
  feed: 'feed',
  timeline: 'feed',
  createroom: 'createroom',
  newroom: 'createroom',
  addbuddy: 'addbuddy',
  addbuddies: 'addbuddy',
};

/** Help topic content — keyed by canonical topic name. Chat-length, warm, opinionated. */
export const TOPICS: Record<string, string> = {
  ims: `IMs are live and ephemeral. Both people online, browser-to-browser, nothing saved anywhere. Old-school AIM energy.

When you close the window, the conversation's gone. That's the point — quick private chats that don't leave a trail.

Persistent encrypted DMs are coming once ATProto ships their encryption spec. For now, IMs are the move for anything you want to disappear.`,

  privacy: `Three tiers, pretty simple:

Public — rooms, messages, your buddy list. These are ATProto records you own. Portable, federated, readable by anyone.

Private — IMs go browser-to-browser via WebRTC. Server never sees the content. Poof when you close the tab.

Ephemeral — your online status and typing indicators live in server memory only. Not logged, not saved.

The server sees which rooms you join and your buddy list (that's ATProto). It never sees your IM content.`,

  themes: `Settings \u2192 Theme. 12+ options.

\u201898 Classic is the default. Dracula goes hard. Synthwave if you're feeling it. Cyberpunk for the vibe. Nord if you like things calm.

Pick one, switch anytime.`,

  translations: `16 languages, auto-translate powered by LibreTranslate.

Click the translate icon on any message, or flip on auto-translate for your whole feed in Settings.

Works in rooms and the feed view.`,

  visibility: `Controls who sees you online in the buddy list:

Everyone \u2014 anyone who has you in their list
Community \u2014 only people in YOUR buddy list
Inner Circle \u2014 just your trusted people
No One \u2014 ghost mode (you can still chat in rooms though)

Set it in the status dropdown by your name. Saved locally, restored on reconnect.

Rooms are different \u2014 if you're in a room, people there can see you regardless.`,

  rooms: `Rooms are public ATProto chat spaces. Your messages are records you own \u2014 portable and federated.

They can have multiple channels, slow mode, allowlists, and mod teams. Room owners run the show.

Browse the room list to join, or check /help createroom to make your own.`,

  community: `Your buddy list is an ATProto record you own. It travels with your account if you ever switch PDS providers.

Default groups: Community and Inner Circle. You can create custom groups too to keep things organized.

Search for people at the top of the buddy list to add them.`,

  innercircle: `Your inner circle is the trust tier. These people get:

\u2022 See your real status even when you're invisible
\u2022 Direct P2P video calls (no relay, lower latency)

Right-click someone in the buddy list \u2192 "Add to Inner Circle" to add them. Choose wisely \u2014 these are the people who can always find you.`,

  presence: `Online \u2014 green dot, you're here.
Away \u2014 yellow dot, optional away message.
Invisible \u2014 look offline, still connected. Only inner circle sees through it.

Set an away message by clicking your status \u2192 Away \u2192 type something. Shows as a little speech bubble in the buddy list.

All in-memory, nothing saved.`,

  calls: `Video calls are peer-to-peer via WebRTC.

Inner circle \u2192 direct P2P connection. Fastest, most private.
Everyone else \u2192 routed through a TURN relay. Still encrypted, just relayed.

Click the video icon in a DM or right-click a buddy to call. You can mute, toggle camera, flip camera, and share your screen.`,

  moderation: `Block \u2014 ATProto-level. They can't see you, can't IM you, can't interact. Immediate.

Report \u2014 /report @handle reason \u2014 goes straight to the mod team.

Room mods can ban users, set slow mode, and enable allowlists.

If someone's being weird, block first, report second. We've got you.`,

  gifs: `/giphy [search] \u2014 GIPHY
/klipy [search] \u2014 Klipy

Pick from results, add alt text if you want, send. Works in rooms and IMs.`,

  polls: `Type /poll in a room to create one.

2-10 options, optional multi-select, optional expiry (1h to 1 week). Votes update live for everyone.`,

  threads: `Hover a message \u2192 Reply to start a thread. Keeps side conversations out of the main timeline.

Reply count shows as a badge on the parent message. Click it to open the thread panel.`,

  richtext: `**bold** \u2014 double asterisks
_italic_ \u2014 underscores
~~strike~~ \u2014 double tildes
\`code\` \u2014 backticks
> quote \u2014 start line with >
@handle \u2014 mentions
Links auto-detect.

Works in rooms and IMs.`,

  portability: `You own your identity. Your DID is permanent \u2014 even if you switch PDS providers, everything moves with you.

Rooms, messages, buddy list \u2014 all ATProto records in your repo. No vendor lock-in. That's the whole point of building on ATProto.`,

  feed: `Feed shows recent messages from rooms you've joined, newest at the bottom.

Auto-translate toggle in Settings. Click any message to jump to that room. Switch between Feed and Buddy List with the buttons at the bottom.`,

  createroom: `Chat Rooms \u2192 Create Room.

Name it, add a topic and description, pick a category. Optional: slow mode, min account age, allowlist-only.

You'll be the owner. You can add mods, manage bans, tweak settings anytime.`,

  addbuddy: `Search bar at the top of the buddy list. Type a handle or name, click to add.

They'll land in your Community group. Right-click to move them to a custom group or add to Inner Circle.

Your buddy list syncs across sessions and moves with your account.`,
};

export const INFO_DM = `protoimsg \u2014 AIM-inspired chat on the AT Protocol.

Rooms, buddy lists, presence, away messages, IMs, video calls, translations. Built for community.

Type /help to see everything I know about.`;

export function roomInfo(name: string, topic: string | null): string {
  const parts = [`Room: ${name}`];
  if (topic) parts.push(`Topic: ${topic}`);
  return parts.join('\n');
}
