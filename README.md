# protoimsg

UNDER CONSTRUCTION

Group chat as an [atproto Lexicon](https://atproto.com/guides/lexicon). Chat rooms, community lists, presence, away messages — all as user-owned records in the AT Protocol.

## Getting Started

**Prerequisites:** Node.js 22+, [pnpm](https://pnpm.io/) 9+, Docker (for Postgres).

```bash
# Install dependencies
pnpm install

# Start Postgres (port 5433 → 5432 in container)
docker compose up -d

# Server: copy env and run migrations
cp packages/server/.env.example packages/server/.env
# Edit packages/server/.env and set DATABASE_URL if needed (default: postgres://protoimsg:localdev@localhost:5433/protoimsg)
pnpm --filter @protoimsg/server db:migrate

# Run everything (server + web)
pnpm dev
```

- **Server** — `http://localhost:3000` (API + WebSocket).
- **Web app** — `http://localhost:5173` (Vite dev server).

Other commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`. See `packages/server/.env.example` for server configuration.

## Namespace

```
app.protoimsg.chat.*
```

All records live in user repositories and are portable across any application that implements this Lexicon.

## Record Schemas

### `app.protoimsg.chat.room`

Declares a chat room. Created by whoever starts the room. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.room",
  "name": "Gotham FC Match Day",
  "topic": "Live chat during Gotham FC games",
  "description": "Pre-game, live, and post-game discussion for NJ/NY Gotham FC matches",
  "purpose": "discussion",
  "createdAt": "2026-02-07T00:00:00Z",
  "settings": {
    "visibility": "public",
    "minAccountAgeDays": 7,
    "slowModeSeconds": 0,
    "allowlistEnabled": false
  }
}
```

| Field         | Type             | Required | Description                                         |
| ------------- | ---------------- | -------- | --------------------------------------------------- |
| `name`        | string (max 100) | yes      | Display name for the room                           |
| `topic`       | string (max 200) | yes      | Room topic for sorting, filtering, and discovery    |
| `description` | string (max 500) | no       | What the room is about                              |
| `purpose`     | string           | yes      | `discussion` \| `event` \| `community` \| `support` |
| `createdAt`   | datetime         | yes      | Timestamp of room creation                          |
| `settings`    | object           | no       | Room configuration (see below)                      |

**`settings` object:**

| Field               | Type    | Default  | Description                                                                         |
| ------------------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| `visibility`        | string  | `public` | `public` (listed in directory) \| `unlisted` (link only) \| `private` (invite only) |
| `minAccountAgeDays` | integer | `0`      | Minimum atproto account age in days to participate                                  |
| `slowModeSeconds`   | integer | `0`      | Minimum seconds between messages per user (0 = off)                                 |
| `allowlistEnabled`  | boolean | `false`  | When true, only allowlisted users can send messages                                 |

---

### `app.protoimsg.chat.message`

A chat message. Lives in the sender's repo, points to a room. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.message",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "text": "What a goal by Lavelle!",
  "facets": [],
  "reply": {
    "root": "at://did:plc:yyy/app.protoimsg.chat.message/root-id",
    "parent": "at://did:plc:yyy/app.protoimsg.chat.message/parent-id"
  },
  "createdAt": "2026-02-07T20:31:00Z"
}
```

| Field       | Type                                      | Required | Description                                                                  |
| ----------- | ----------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `room`      | at-uri                                    | yes      | AT-URI of the room record                                                    |
| `text`      | string (max 3000 bytes / 1000 graphemes)  | yes      | Message content                                                              |
| `facets`    | richTextFacet[]                           | no       | Rich text annotations (mentions, links) — same format as Bluesky post facets |
| `reply`     | replyRef                                  | no       | Structured thread reference (root + parent)                                  |
| `embed`     | imageEmbed \| videoEmbed \| externalEmbed | no       | Embedded media or link card                                                  |
| `createdAt` | datetime                                  | yes      | Timestamp of message creation                                                |

**Rich text facets** follow the same `byteSlice` + features model as `app.bsky.feed.post`. Each facet targets a byte range and annotates it as a `#mention` (with `did`) or `#link` (with `uri`).

**Reply threading** uses a structured `reply` object with both `root` (thread root) and `parent` (direct parent) AT-URIs for efficient deep thread traversal, matching the pattern used by `app.bsky.feed.post`.

**Embeds** support three types: `#imageEmbed` (up to 4 images with alt text and aspect ratio), `#videoEmbed` (single video with optional thumbnail), and `#externalEmbed` (link card with title, description, and thumb).

---

### `app.protoimsg.chat.community`

The user's community list. Portable across any app implementing the Lexicon. Key: `literal:self` (singleton per user).

```json
{
  "$type": "app.protoimsg.chat.community",
  "groups": [
    {
      "name": "Inner Circle",
      "isInnerCircle": true,
      "members": [
        { "did": "did:plc:abc", "addedAt": "2026-01-15T00:00:00Z" },
        { "did": "did:plc:def", "addedAt": "2026-01-20T00:00:00Z" }
      ]
    },
    {
      "name": "Soccer People",
      "isInnerCircle": false,
      "members": [{ "did": "did:plc:ghi", "addedAt": "2026-02-01T00:00:00Z" }]
    }
  ]
}
```

| Field    | Type                      | Required | Description                       |
| -------- | ------------------------- | -------- | --------------------------------- |
| `groups` | communityGroup[] (max 50) | yes      | Named groups of community members |

**`communityGroup` object:**

| Field           | Type                        | Required             | Description                                                     |
| --------------- | --------------------------- | -------------------- | --------------------------------------------------------------- |
| `name`          | string (max 100)            | yes                  | Group label                                                     |
| `isInnerCircle` | boolean                     | no (default `false`) | Whether members of this group can see your real presence status |
| `members`       | communityMember[] (max 500) | yes                  | DIDs of group members                                           |

**`communityMember` object:**

| Field     | Type     | Required | Description                |
| --------- | -------- | -------- | -------------------------- |
| `did`     | did      | yes      | The member's DID           |
| `addedAt` | datetime | yes      | When this member was added |

---

### `app.protoimsg.chat.presence`

User's current presence status. Lives in their repo, updated by their client. Key: `literal:self` (singleton per user).

```json
{
  "$type": "app.protoimsg.chat.presence",
  "status": "online",
  "visibleTo": "inner-circle",
  "awayMessage": "only my people know I'm here",
  "updatedAt": "2026-02-07T19:00:00Z"
}
```

| Field         | Type             | Required | Description                                              |
| ------------- | ---------------- | -------- | -------------------------------------------------------- |
| `status`      | string           | yes      | `online` \| `away` \| `idle` \| `offline` \| `invisible` |
| `visibleTo`   | string           | yes      | `everyone` \| `community` \| `inner-circle` \| `no-one`  |
| `awayMessage` | string (max 300) | no       | Custom status text (the AIM away message)                |
| `updatedAt`   | datetime         | yes      | When presence was last updated                           |

See [Presence Visibility](#presence-visibility) for how `visibleTo` interacts with the community list.

---

### `app.protoimsg.chat.poll`

A poll within a chat room. Lives in the creator's repo. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.poll",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "question": "MOTM?",
  "options": ["Lavelle", "Shaw", "Sonnett", "Berger"],
  "allowMultiple": false,
  "expiresAt": "2026-02-07T22:00:00Z",
  "createdAt": "2026-02-07T20:45:00Z"
}
```

| Field           | Type                                | Required             | Description                                |
| --------------- | ----------------------------------- | -------------------- | ------------------------------------------ |
| `room`          | at-uri                              | yes                  | AT-URI of the room                         |
| `question`      | string (max 200)                    | yes                  | The poll question                          |
| `options`       | string[] (2-10 items, max 100 each) | yes                  | Answer options                             |
| `allowMultiple` | boolean                             | no (default `false`) | Whether voters can select multiple options |
| `expiresAt`     | datetime                            | no                   | When the poll closes (omit for no expiry)  |
| `createdAt`     | datetime                            | yes                  | Timestamp of poll creation                 |

---

### `app.protoimsg.chat.vote`

A vote on a poll. Lives in the voter's repo. Votes are separate records so they're user-owned and independently verifiable. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.vote",
  "poll": "at://did:plc:xxx/app.protoimsg.chat.poll/poll-id",
  "selectedOptions": [0],
  "createdAt": "2026-02-07T20:46:00Z"
}
```

| Field             | Type      | Required | Description                         |
| ----------------- | --------- | -------- | ----------------------------------- |
| `poll`            | at-uri    | yes      | AT-URI of the poll being voted on   |
| `selectedOptions` | integer[] | yes      | 0-based indices of selected options |
| `createdAt`       | datetime  | yes      | Timestamp of vote                   |

---

### `app.protoimsg.chat.ban`

A ban issued by a room owner or moderator. Lives in the issuer's repo. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.ban",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "subject": "did:plc:banned-user",
  "reason": "Spam",
  "createdAt": "2026-02-07T21:00:00Z"
}
```

| Field       | Type             | Required | Description                           |
| ----------- | ---------------- | -------- | ------------------------------------- |
| `room`      | at-uri           | yes      | AT-URI of the room the ban applies to |
| `subject`   | did              | yes      | DID of the banned user                |
| `reason`    | string (max 300) | no       | Reason for the ban                    |
| `createdAt` | datetime         | yes      | Timestamp of ban                      |

---

### `app.protoimsg.chat.role`

Assigns a moderator or owner role to a user for a specific room. Lives in the assigner's repo. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.role",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "subject": "did:plc:trusted-user",
  "role": "moderator",
  "createdAt": "2026-02-07T21:00:00Z"
}
```

| Field       | Type     | Required | Description                             |
| ----------- | -------- | -------- | --------------------------------------- |
| `room`      | at-uri   | yes      | AT-URI of the room                      |
| `subject`   | did      | yes      | DID of the user being assigned the role |
| `role`      | string   | yes      | `moderator` \| `owner`                  |
| `createdAt` | datetime | yes      | Timestamp of role assignment            |

---

### `app.protoimsg.chat.allowlist`

An allowlist entry for a room. When a room has `allowlistEnabled: true`, only allowlisted users can send messages. Lives in the room owner/mod's repo. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.allowlist",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "subject": "did:plc:allowed-user",
  "createdAt": "2026-02-07T21:00:00Z"
}
```

| Field       | Type     | Required | Description                                 |
| ----------- | -------- | -------- | ------------------------------------------- |
| `room`      | at-uri   | yes      | AT-URI of the room the allowlist applies to |
| `subject`   | did      | yes      | DID of the allowlisted user                 |
| `createdAt` | datetime | yes      | Timestamp of allowlist entry creation       |

---

## Presence Visibility

The presence model has an inner-circle design inspired by AIM's buddy list visibility. Your `presence` record declares both your status and _who gets to see it_.

**`visibleTo` values:**

- **`everyone`** — all community members and room participants see your real status and away message.
- **`community`** — only users in your community list see your real status. Everyone else sees `offline`.
- **`inner-circle`** — only users in community groups where `isInnerCircle: true` see your real status. Everyone else sees `offline`.
- **`no-one`** — you appear `offline` to everyone. Like `invisible` status, but explicit in the record.

**How it works at the protocol level:**

1. Alice sets her presence to `{ status: "online", visibleTo: "inner-circle" }`.
2. Bob requests Alice's presence from the server.
3. The server checks Alice's `community` record — is Bob's DID in any group where `isInnerCircle: true`?
4. If yes: Bob sees `online`. If no: Bob sees `offline`.

The away message follows the same visibility rules. If you can't see someone's status, you can't see their away message either.

This keeps the community list portable (it's a user-owned atproto record) and the visibility logic simple enough for any implementing server to enforce.
