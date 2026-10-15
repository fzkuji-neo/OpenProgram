# Chat-Bot Behavior on Channels

An agent reached through WeChat, Telegram, Discord or Slack is used
differently from one in the web app. In the web app one owner types into
a conversation, waits for a transcript, and reads tool output. In a chat
app the agent sits in a room with other people, most messages are not
addressed to it, a reply is a phone notification, and nobody sees the
tool calls. This page sets out what that difference asks of the channel
layer, how OpenClaw, Hermes Agent and Poke answer it, and the design
OpenProgram follows.

The conclusion first: a chat bot is not a second kind of agent. It is
the same `Agent` with the same runtime, tools and memory, reached through
a room layer that decides which messages become turns and a delivery
layer that shapes how replies leave. Both layers live in `channels/`;
the agent keeps one definition whichever surface reaches it. OpenClaw and
Hermes are built the same way: one agent, channel behavior in
configuration.

## 1. What a Room Needs

| Need | Why a chat differs from the web app |
|---|---|
| Know who spoke | A group or a `session_scope: main` agent puts several people in one conversation |
| Stay quiet by default | Most group messages are people talking to each other |
| Still hear the room | A question three messages after "@bot" depends on those three messages |
| Decide to speak | An assistant that is useful in a room joins in when it has something to add, not on every line |
| Reply like a person | Short paragraphs, sent as they are ready; a typing indicator while working; no tool transcript |
| Limit strangers | A group member is not the owner; tools that touch the owner's machine stay with the owner |
| Not talk to other bots forever | Two bots in one room answer each other until something stops them |
| Recognize one person across apps | The same person on WeChat and Telegram is one subject for memory |
| Speak first | Reminders, follow-ups and check-ins arrive without a prompt |

## 2. Reference Systems

**OpenClaw** ([channels](https://docs.openclaw.ai/channels),
[groups](https://docs.openclaw.ai/channels/groups),
[ambient room events](https://docs.openclaw.ai/channels/ambient-room-events),
[sessions](https://docs.openclaw.ai/concepts/session),
[streaming](https://docs.openclaw.ai/concepts/streaming),
[typing](https://docs.openclaw.ai/concepts/typing-indicators),
[bot loop protection](https://docs.openclaw.ai/channels/bot-loop-protection))
is the most complete room layer. Its pieces:

- Access: DM pairing and allowlists; `groupPolicy` of allowlist, open or
  disabled per group.
- Mention gating: `requireMention`, extra `mentionPatterns`, and a reply
  to the bot counting as a mention; `/activation mention|always` switches
  a group at runtime.
- Pending history: unmentioned group messages are kept (`historyLimit`,
  default 50) and handed to the next triggered turn, so the agent sees
  what led up to the mention.
- Ambient rooms: with `unmentionedInbound: "room_event"` and
  `visibleReplies: "message_tool"`, every group message reaches the
  agent, the agent's final text stays private, and the room only hears
  from it when it calls the `message` tool. Typing is suppressed for these
  turns.
- Per-group and per-sender tool policy (`tools`, `toolsBySender`), and a
  sandbox for non-main sessions.
- Session shape: `dmScope` from one shared session to one per
  account, channel and peer; `identityLinks` merging one person's
  accounts; daily or idle reset; `/new` and `/reset`.
- Delivery: block streaming with paragraph-sized chunks (`minChars`,
  `maxChars`, coalescing, newline mode), live preview edits where the
  platform allows them, typing indicators with a keepalive interval, ack
  reactions.
- Bot loop protection, a one-time group introduction, heartbeats that skip
  group sessions, voice-note transcription and media in both directions.
- WeChat is an external plugin maintained by Tencent's Weixin team
  ([WeChat](https://docs.openclaw.ai/channels/wechat)): direct chats and
  media, no group chats, QR login through iLink.

**Hermes Agent** ([docs](https://hermes-agent.nousresearch.com/docs/),
[repository](https://github.com/NousResearch/hermes-agent)) puts its weight
on what the bot learns. The agent curates its own `MEMORY.md` and
`USER.md`, is nudged periodically to save what it learned, writes new
skills from tasks it solved, and recalls past conversations through
full-text search plus summaries. One gateway serves about twenty
platforms, and a user is one identity across them. Scheduled jobs deliver
to any platform.

**Poke** ([poke.com](https://poke.com)) is the product end of the same
idea: an assistant that lives in iMessage and SMS, has a fixed voice,
texts first when something in the user's mail or calendar needs
attention, and treats those accounts as its memory. What it shows is that
"speaks first" and "has a personality" are what make a chat assistant
feel present.

## 3. Where OpenProgram Stands

| Capability | OpenClaw | OpenProgram |
|---|---|---|
| Platforms | 34, WeChat by plugin | Telegram, Discord, Slack, WeChat (iLink) |
| DM pairing, allowlist | Yes | Yes |
| Sender identity to the model | Text label plus metadata block | Structured `speaker_*` fields in the input envelope |
| Sender shown in the web transcript | — | Platform and sender above the bubble |
| Mention gating | All group channels, patterns, reply-to-bot | Telegram `require_mention`, reply-to-bot |
| `/activation`, `/new`, `/reset` | Yes | No |
| Pending group history | Yes | No |
| Ambient rooms, agent decides to speak | Yes | No |
| Per-group, per-sender tool policy | Yes | Tier policy per paired sender; no per-group policy |
| Session scope, reset policy | Yes | `session_scope`, daily or idle reset |
| Cross-channel identity links | Yes | No |
| Live progress | Preview edits | Placeholder edited with tool steps |
| Paragraph chunking while running | Yes | Split at the platform cap after the reply is done |
| Typing indicator | Yes | No |
| Ack reaction | Yes | No |
| Bot loop protection | Yes | No |
| Group introduction | Yes | No |
| Media in and out | Yes | Yes, except WeChat (text only) |
| Voice transcription | Yes | No |
| Questions back to the user | — | `/answer`, `/decline` |
| Proactive delivery | Heartbeats, cron | Always-on agents deliver to a channel |
| Self-curated memory, skills | Hermes | Shared memory workspace, per-person topics |

## 4. Design

### 4.1 Room Modes

Each group binding has one mode, set in configuration and switched at
runtime by `/activation`:

- **mention** (default): only a mention, a mention pattern or a reply to
  the bot starts a turn. Everything else is recorded as pending history.
- **always**: every message starts a turn, as Telegram's
  `require_mention off` does today.
- **ambient**: every message reaches the agent as a room event, and the
  room only hears from the agent through a `send_message` tool. The final
  text of an ambient turn stays in the transcript. No typing indicator
  runs for these turns.

Direct messages are always on and never gated.

### 4.2 Pending History

A gated message is stored on the session as a pending room entry with its
speaker fields, not as a turn. The next turn that starts takes the
newest entries up to `history_limit` (default 50) and passes them as
one quoted block of `speaker: text` lines ahead of the triggering
message, each line rendered through the same JSON envelope as live
input, so a pending line cannot pose as a different speaker. Entries the
turn consumed are cleared. Pending history never wakes the agent by
itself.

### 4.3 Delivery

The delivery layer turns one reply into chat-shaped messages:

- A typing indicator starts when a turn starts and refreshes every few
  seconds until the first message leaves (Telegram `sendChatAction`,
  Discord typing, WeChat's iLink typing status where available).
- On platforms that cannot edit (WeChat), text is sent in paragraph
  chunks as the reply grows: a chunk leaves at a paragraph break once it
  has `min_chars`, and never exceeds `max_chars`. Platforms that can edit
  keep the live placeholder.
- An optional ack reaction marks a message the bot has picked up, for
  platforms with reactions.
- Tool steps never reach the room in ambient mode and never on WeChat.

### 4.4 Who May Do What

The sender's authority tier already decides what a turn may do. A room
adds two things: a per-binding tool policy (a group can be limited to
reading and memory tools) and a rule that non-owner speakers never get
the owner's local-machine tools, whatever the binding says. A
confirmation question raised in a group is only answerable by the owner.

### 4.5 Loops and Floods

Messages from bot accounts are dropped unless the binding allows a named
bot. A per-room limit caps how many turns the agent takes in a sliding
window; past the cap, messages fall into pending history.

### 4.6 One Person Across Channels

An identity link maps several `channel:speaker_id` pairs to one person
id. Memory files that person under one topic, and a binding may choose to
give a linked person one direct session across channels.

### 4.7 Speaking First and Personality

Always-on agents already deliver to a channel on a schedule. A chat bot
adds a short persona (voice, length, emoji use) kept in the agent's
profile and applied only to channel turns, and per-person follow-ups that
memory schedules ("remind me Friday") delivered to the person's last
active channel. Heartbeats skip group sessions.

### 4.8 WeChat

iLink carries image, voice, file and video items besides text. The
adapter reads them through the shared attachment path, voice notes
included, and sends files back the way the other adapters do. iLink has
no groups and no message edits, so WeChat always uses paragraph chunking
and never the live placeholder.

## Appendix — Implementation Status

Implemented: pairing and allowlist, structured speaker identity in the
input envelope and the web transcript, Telegram mention gating with
reply-to-bot, session scope and reset policy, live progress placeholder,
per-platform markdown and size-cap splitting, attachments on Telegram,
Discord and Slack, `/answer` and `/decline`, always-on delivery.

Not implemented: room modes and `/activation` (4.1), `/new` and `/reset`,
pending history (4.2), typing indicators, paragraph chunking and ack
reactions (4.3), per-binding tool policy and the owner-only rule (4.4),
bot loop and flood limits (4.5), identity links (4.6), channel persona and
memory-scheduled follow-ups (4.7), WeChat media and voice (4.8), voice
transcription on any platform, group introductions.
