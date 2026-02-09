# chatmosphere

UNDER CONSTRUCTION

Group chat as an [atproto Lexicon](https://atproto.com/guides/lexicon). Chat rooms, buddy lists, presence, away messages — all as user-owned records in the AT Protocol.

## Namespace

```
app.chatmosphere.chat.*
```

All records live in user repositories and are portable across any application that implements this Lexicon.

## Record Schemas

### `app.chatmosphere.chat.room`

Declares a chat room. Created by whoever starts the room. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.room",
  "name": "Gotham FC Match Day",
  "description": "Live chat during Gotham FC games",
  "purpose": "discussion",
  "createdAt": "2026-02-07T00:00:00Z",
  "settings": {
    "visibility": "public",
    "minAccountAgeDays": 7,
    "slowModeSeconds": 0
  }
}
```

| Field         | Type             | Required | Description                                         |
| ------------- | ---------------- | -------- | --------------------------------------------------- |
| `name`        | string (max 100) | yes      | Display name for the room                           |
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

---

### `app.chatmosphere.chat.message`

A chat message. Lives in the sender's repo, points to a room. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.message",
  "room": "at://did:plc:xxx/app.chatmosphere.chat.room/room-id",
  "text": "What a goal by Lavelle!",
  "facets": [],
  "replyTo": "at://did:plc:yyy/app.chatmosphere.chat.message/msg-id",
  "createdAt": "2026-02-07T20:31:00Z"
}
```

| Field       | Type                                     | Required | Description                                                                  |
| ----------- | ---------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `room`      | at-uri                                   | yes      | AT-URI of the room record                                                    |
| `text`      | string (max 3000 bytes / 1000 graphemes) | yes      | Message content                                                              |
| `facets`    | richTextFacet[]                          | no       | Rich text annotations (mentions, links) — same format as Bluesky post facets |
| `replyTo`   | at-uri                                   | no       | AT-URI of another message (threading)                                        |
| `createdAt` | datetime                                 | yes      | Timestamp of message creation                                                |

**Rich text facets** follow the same `byteSlice` + features model as `app.bsky.feed.post`. Each facet targets a byte range and annotates it as a `#mention` (with `did`) or `#link` (with `uri`).

---

### `app.chatmosphere.chat.buddylist`

The user's buddy list. Portable across any app implementing the Lexicon. Key: `literal:self` (singleton per user).

```json
{
  "$type": "app.chatmosphere.chat.buddylist",
  "groups": [
    {
      "name": "Close Friends",
      "isCloseFriends": true,
      "members": [
        { "did": "did:plc:abc", "addedAt": "2026-01-15T00:00:00Z" },
        { "did": "did:plc:def", "addedAt": "2026-01-20T00:00:00Z" }
      ]
    },
    {
      "name": "Soccer People",
      "isCloseFriends": false,
      "members": [{ "did": "did:plc:ghi", "addedAt": "2026-02-01T00:00:00Z" }]
    }
  ]
}
```

| Field    | Type                  | Required | Description                                               |
| -------- | --------------------- | -------- | --------------------------------------------------------- |
| `groups` | buddyGroup[] (max 50) | yes      | Named groups of buddies, like AIM's buddy list categories |

**`buddyGroup` object:**

| Field            | Type                    | Required             | Description                                                     |
| ---------------- | ----------------------- | -------------------- | --------------------------------------------------------------- |
| `name`           | string (max 100)        | yes                  | Group label                                                     |
| `isCloseFriends` | boolean                 | no (default `false`) | Whether members of this group can see your real presence status |
| `members`        | buddyMember[] (max 500) | yes                  | DIDs of group members                                           |

**`buddyMember` object:**

| Field     | Type     | Required | Description               |
| --------- | -------- | -------- | ------------------------- |
| `did`     | did      | yes      | The buddy's DID           |
| `addedAt` | datetime | yes      | When this buddy was added |

---

### `app.chatmosphere.chat.presence`

User's current presence status. Lives in their repo, updated by their client. Key: `literal:self` (singleton per user).

```json
{
  "$type": "app.chatmosphere.chat.presence",
  "status": "online",
  "visibleTo": "close-friends",
  "awayMessage": "only my people know I'm here",
  "updatedAt": "2026-02-07T19:00:00Z"
}
```

| Field         | Type             | Required | Description                                              |
| ------------- | ---------------- | -------- | -------------------------------------------------------- |
| `status`      | string           | yes      | `online` \| `away` \| `idle` \| `offline` \| `invisible` |
| `visibleTo`   | string           | yes      | `everyone` \| `close-friends` \| `nobody`                |
| `awayMessage` | string (max 300) | no       | Custom status text (the AIM away message)                |
| `updatedAt`   | datetime         | yes      | When presence was last updated                           |

See [Presence Visibility](#presence-visibility) for how `visibleTo` interacts with the buddy list.

---

### `app.chatmosphere.chat.poll`

A poll within a chat room. Lives in the creator's repo. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.poll",
  "room": "at://did:plc:xxx/app.chatmosphere.chat.room/room-id",
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

### `app.chatmosphere.chat.vote`

A vote on a poll. Lives in the voter's repo. Votes are separate records so they're user-owned and independently verifiable. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.vote",
  "poll": "at://did:plc:xxx/app.chatmosphere.chat.poll/poll-id",
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

### `app.chatmosphere.chat.ban`

A ban issued by a room owner or moderator. Lives in the issuer's repo. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.ban",
  "room": "at://did:plc:xxx/app.chatmosphere.chat.room/room-id",
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

### `app.chatmosphere.chat.role`

Assigns a moderator or owner role to a user for a specific room. Lives in the assigner's repo. Key: `tid`.

```json
{
  "$type": "app.chatmosphere.chat.role",
  "room": "at://did:plc:xxx/app.chatmosphere.chat.room/room-id",
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

## Presence Visibility

The presence model has a close-friends design inspired by AIM's buddy list visibility. Your `presence` record declares both your status and _who gets to see it_.

**`visibleTo` values:**

- **`everyone`** — all buddies and room participants see your real status and away message.
- **`close-friends`** — only users in buddy groups where `isCloseFriends: true` see your real status. Everyone else sees `offline`.
- **`nobody`** — you appear `offline` to everyone. Like `invisible` status, but explicit in the record.

**How it works at the protocol level:**

1. Alice sets her presence to `{ status: "online", visibleTo: "close-friends" }`.
2. Bob requests Alice's presence from the server.
3. The server checks Alice's `buddylist` record — is Bob's DID in any group where `isCloseFriends: true`?
4. If yes: Bob sees `online`. If no: Bob sees `offline`.

The away message follows the same visibility rules. If you can't see someone's status, you can't see their away message either.

This keeps the close-friends list portable (it's a user-owned atproto record) and the visibility logic simple enough for any implementing server to enforce.
