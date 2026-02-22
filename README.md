# protoimsg

**Find your people. Build your feed.**

protoimsg is a real-time communications platform built on the AT Protocol. Public chat rooms are where you discover people. Your buddy list is where you keep them. Peer-to-peer video and messaging is how you stay connected. Your inner circle gets pure peer-to-peer by default (unless you opt out), everyone else is routed through our relay to hide your IP address. You can switch to pure P2P anytime. The relay exists only to protect you: nothing is stored, no media is logged, and all traffic is encrypted end-to-end (DTLS-SRTP) so even the relay can't see your data. If someone's offline, reach them through [Germ](https://germnetwork.com) for persistent E2E-encrypted DMs.

Your identity, contacts, and public chat history are yours, portable across any app that implements the [Lexicon](./PROTOCOL.md).

**Now in beta.** [protoimsg.app](https://protoimsg.app) is live with a waitlist. [Sign up for beta access](https://protoimsg.app/beta-signup) or reach out on [Bluesky](https://bsky.app/profile/grishalr.bsky.social).

## What it is

- **Peer-to-peer video calling** — Free video calls powered by WebRTC. Pure P2P for your inner circle: direct connection, zero latency. Everyone else routes through our TURN relay to keep your IP address private. No third-party STUN servers — all infrastructure is self-hosted so your IP is never leaked to Google or anyone else. Tested NYC to Europe with clear video and no lag.

- **Public chat rooms** — Join rooms by interest, meet people, and follow the ones you vibe with. The chat rooms have threaded replies, rich text, polls, GIF search (/giphy, /klipy), and room history that persists so you can discover people even after the conversation has moved on.

- **Instant messaging** — Real-time IMs when both people are online. Same trust-aware routing as video: pure P2P for your inner circle, relay for everyone else. Relay is mandatory for non-inner-circle connections — users cannot override this to protect IP addresses. For offline messaging, use [Germ](https://germnetwork.com) integration for persistent E2E-encrypted DMs.

- **Community list, not follow graph** — Your buddy list is separate from who you follow. You might want to chat with people you don't follow, and you might not want to chat with people you do follow. Your community list is organized into groups: **Everyone**, **Community**, and **Inner Circle**. Each tier controls who can see you online. Inner Circle controls trust-aware routing: your inner circle gets pure P2P connections, everyone else is relayed.

- **Translation** — The entire UI, chat rooms, messages, and feed available in 8 languages (English, Spanish, Russian, Arabic, Ukrainian, Irish, Swahili, Hausa). Turn on auto-translate in settings or translate individual messages on demand. Powered by NLLB and LibreTranslate, both self-hosted. No data sent to third parties. Migrating fully to NLLB.

- **E2E encrypted DMs** — Integration with [Germ](https://germnetwork.com) for persistent, end-to-end encrypted private messaging when you or the other person is offline.

- **Moderation** — Block/report users, room bans, account age gates, slow mode, allowlists. ATProto labeler integration respects your existing moderation preferences.

- **Desktop & mobile apps** — Native desktop app via Tauri, in active development. Mobile is coming. Both will be in the Apple and Google stores.

- **Themeable** — 12 design themes including the default '98 Classic.

## How it works

Sign in with your atproto handle from any PDS: Bluesky, Blacksky, North Sky, or your own. No new account, no phone number, no email. Your existing AT Protocol identity is your identity on protoimsg.

The product is built on a three-layer architecture:

| Layer         | Technology                     | What it does                                                                                                                   |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Identity**  | AT Protocol                    | Portable, user-owned identity. No account lock-in.                                                                             |
| **Trust**     | Community lists + inner-circle | Who sees your presence, who gets P2P vs relay routing.                                                                         |
| **Transport** | WebRTC                         | Trust-aware routing. Inner circle gets STUN (pure P2P). Everyone else gets TURN (relayed, IP hidden). No third-party fallback. |

### Messaging tiers

Different conversations need different infrastructure:

- **IMs (live/ephemeral)** — Peer-to-peer instant messages via WebRTC data channels when both people are online. Device-to-device — nothing stored on the server.
- **DMs (persistent E2E)** — [Germ](https://germnetwork.com) integration. For async private messages that survive both parties being offline. End-to-end encrypted via MLS.
- **Room chat** — ATProto records via the protoimsg server. For group rooms, public/community chat. Durable, searchable, portable.

## Not feed-first

ATProto has great feed-based apps, and protoimsg is meant to complement them. You join a room, meet people, and build your social graph from there, then follow them on whatever ATProto client you use. The chat room is the discovery mechanism for your feed, not the other way around.

This is where you _build_ your feed: discover people through conversation, follow the ones you connect with. Your atproto feed is here if you want it. Browse and post without leaving the app. But we're not trying to be a feed client. There are better ones out there: [Blacksky](https://blacksky.app), [Skeets](https://www.skeetsapp.com/), [Bluesky](https://bsky.app), [Graysky](https://graysky.app), and others. We're focused on the conversations.

## Planned

| Feature              | Notes                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Group video calls    | Multi-party video from chat rooms. 1:1 already shipped.           |
| Private chat rooms   | Multi-party, peer-to-peer via WebRTC. Nothing stored server-side. |
| Custom theme creator | Build your own theme, stored in ATProto for portability           |

## Protocol

All records live under the `app.protoimsg.chat.*` namespace in user repositories and are portable across any application that implements this Lexicon.

Full Lexicon reference including all record schemas (room, message, community, presence, poll, vote, ban, role, allowlist) is available in [PROTOCOL.md](./PROTOCOL.md).

## Getting started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, development workflow, code style, and how to run translation backends.

## Stack

TypeScript monorepo (Turborepo + pnpm workspaces). Vite + React 19 web client. Node.js server with WebSocket. WebRTC for P2P video/voice/data. Tauri v2 desktop app. PostgreSQL + Redis. NLLB + LibreTranslate translation servers. Deployed on Fly.io (server, TURN, translation) + Vercel (web). Full CI/CD via GitHub Actions.

## License

MIT
