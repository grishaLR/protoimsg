# protoimsg Lexicon Reference

Group chat as an [ATProto Lexicon](https://atproto.com/guides/lexicon). Chat rooms, channels, community lists, presence, away messages — all as user-owned records in the AT Protocol.

## Namespace

```
app.protoimsg.chat.*
```

Authority is rooted in DNS ownership of `protoimsg.app` per the [ATProto NSID spec](https://atproto.com/specs/nsid). All records live in user repositories and are portable across any application that implements this Lexicon.

**Schema source files:** [`packages/lexicon/schemas/app/protoimsg/chat/`](./packages/lexicon/schemas/app/protoimsg/chat/)

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

### `app.protoimsg.chat.channel`

A channel within a chat room (like Discord channels). Created by the room owner. Each room has at least one default channel ("general"). Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.channel",
  "room": "at://did:plc:xxx/app.protoimsg.chat.room/room-id",
  "name": "general",
  "description": "Main discussion channel",
  "position": 0,
  "postPolicy": "everyone",
  "createdAt": "2026-02-07T00:00:00Z"
}
```

| Field         | Type             | Required | Description                                        |
| ------------- | ---------------- | -------- | -------------------------------------------------- |
| `room`        | at-uri           | yes      | AT-URI of the room this channel belongs to         |
| `name`        | string (max 100) | yes      | Display name for the channel                       |
| `description` | string (max 500) | no       | What the channel is about                          |
| `position`    | integer (min 0)  | no       | Sort position within the room. Lower numbers first |
| `postPolicy`  | string           | no       | `everyone` \| `owner` \| `moderators`              |
| `createdAt`   | datetime         | yes      | Timestamp of channel creation                      |

---

### `app.protoimsg.chat.message`

A chat message. Lives in the sender's repo, points to a channel. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.message",
  "channel": "at://did:plc:xxx/app.protoimsg.chat.channel/channel-id",
  "text": "What a goal by Lavelle!",
  "facets": [],
  "reply": {
    "root": "at://did:plc:yyy/app.protoimsg.chat.message/root-id",
    "parent": "at://did:plc:yyy/app.protoimsg.chat.message/parent-id"
  },
  "createdAt": "2026-02-07T20:31:00Z"
}
```

| Field       | Type                                      | Required | Description                                 |
| ----------- | ----------------------------------------- | -------- | ------------------------------------------- |
| `channel`   | at-uri                                    | yes      | AT-URI of the channel record                |
| `text`      | string (max 3000 bytes / 1000 graphemes)  | yes      | Message content                             |
| `facets`    | richTextFacet[]                           | no       | Rich text annotations (see below)           |
| `reply`     | replyRef                                  | no       | Structured thread reference (root + parent) |
| `embed`     | imageEmbed \| videoEmbed \| externalEmbed | no       | Embedded media or link card                 |
| `createdAt` | datetime                                  | yes      | Timestamp of message creation               |

**Rich text facets** follow the same `byteSlice` + features model as `app.bsky.feed.post`. Each facet targets a byte range and annotates it with one or more features:

- `#mention` — mention of another account (with `did`)
- `#link` — URL (with `uri`)
- `#tag` — hashtag (with `tag`, max 64 graphemes)
- `#bold`, `#italic`, `#strikethrough` — inline formatting
- `#codeInline` — inline code
- `#codeBlock` — code block (with optional `lang` for syntax highlighting)
- `#blockquote` — block quotation

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

> **Privacy note:** The `visibleTo` preference (who can see your status) is intentionally **not** part of this record. Writing it to the PDS would publicly expose who you're hiding from. Visibility preferences are managed server-side only.

```json
{
  "$type": "app.protoimsg.chat.presence",
  "status": "online",
  "awayMessage": "brb, grabbing coffee",
  "updatedAt": "2026-02-07T19:00:00Z"
}
```

| Field         | Type             | Required | Description                                              |
| ------------- | ---------------- | -------- | -------------------------------------------------------- |
| `status`      | string           | yes      | `online` \| `away` \| `idle` \| `offline` \| `invisible` |
| `awayMessage` | string (max 300) | no       | Custom status text (the AIM away message)                |
| `updatedAt`   | datetime         | yes      | When presence was last updated                           |

See [Presence Visibility](#presence-visibility) for how server-side visibility settings interact with the community list.

---

### `app.protoimsg.chat.poll`

A poll within a chat channel. Lives in the creator's repo. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.poll",
  "channel": "at://did:plc:xxx/app.protoimsg.chat.channel/channel-id",
  "question": "MOTM?",
  "options": ["Lavelle", "Shaw", "Sonnett", "Berger"],
  "allowMultiple": false,
  "expiresAt": "2026-02-07T22:00:00Z",
  "createdAt": "2026-02-07T20:45:00Z"
}
```

| Field           | Type                                | Required             | Description                                |
| --------------- | ----------------------------------- | -------------------- | ------------------------------------------ |
| `channel`       | at-uri                              | yes                  | AT-URI of the channel                      |
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

### `app.protoimsg.chat.authVerify`

Ephemeral challenge-response record for login. The client writes this to prove PDS write access, the server verifies the nonce, then the client deletes it immediately. Key: `tid`.

```json
{
  "$type": "app.protoimsg.chat.authVerify",
  "nonce": "a1b2c3d4e5f6",
  "createdAt": "2026-02-07T19:00:00Z"
}
```

| Field       | Type     | Required | Description                                         |
| ----------- | -------- | -------- | --------------------------------------------------- |
| `nonce`     | string   | yes      | Server-issued challenge nonce to prove write access |
| `createdAt` | datetime | yes      | When this verification record was created           |

This record is never meant to persist. It exists for the ~2 seconds between challenge issuance and verification. The server issues a 60-second nonce, the client writes it to their PDS, the server reads it back via `com.atproto.repo.getRecord`, and the client deletes it.

---

## Presence Visibility

The presence model has an inner-circle design inspired by AIM's buddy list visibility. Your `presence` record declares your status and away message. _Who gets to see it_ is a separate, server-side preference that never touches the PDS.

**Visibility levels** (set via WebSocket, stored server-side only):

- **`everyone`** — all community members and room participants see your real status and away message.
- **`community`** — only users in your community list see your real status. Everyone else sees `offline`.
- **`inner-circle`** — only users in community groups where `isInnerCircle: true` see your real status. Everyone else sees `offline`.
- **`no-one`** — you appear `offline` to everyone. Like `invisible` status, but explicit.

**How it works at the protocol level:**

1. Alice sets her presence to `{ status: "online" }` (written to PDS) and her visibility to `"inner-circle"` (sent via WebSocket, stored server-side).
2. Bob requests Alice's presence from the server.
3. The server checks Alice's `community` record — is Bob's DID in any group where `isInnerCircle: true`?
4. If yes: Bob sees `online`. If no: Bob sees `offline`.

The away message follows the same visibility rules. If you can't see someone's status, you can't see their away message either.

This keeps the community list portable (it's a user-owned ATProto record), the visibility logic simple enough for any implementing server to enforce, and privacy preferences private (never written to publicly-readable PDS records).
