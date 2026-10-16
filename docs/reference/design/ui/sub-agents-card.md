# Sub-agents card

A turn that spawns agents shows them in one **Sub-agents card**, next to
the file-change and error cards. Each agent is a tab; opening a tab shows
that agent's own conversation inside the card. The conversation's
transcript keeps only its own turns.

Related: [`chat-turn-visual-spec.html`](chat-turn-visual-spec.html)
(execution timeline and the sub-agent step row),
[`indicator-dots.md`](indicator-dots.md) (tab status dots).
Code: `apps/web/components/chat/messages/sub-agents-card.tsx`,
`apps/web/lib/chat/sub-agent-transcripts.ts`,
`apps/web/lib/net/chat-stream.ts` (`handleSubAgentResponse`),
`openprogram/agent/production_driver/execution.py` (`_turn_event_sink`),
`apps/server/openprogram_server/_webui/ws_actions/sub_agent.py`
(`load_sub_agent_transcript`).

## Why the transcript needs it

A sub-agent (an `agent` spawn, or a later `send_message` to it) runs as a
Job whose turns are a branch of the **same session**. Its live chat frames
therefore carry the conversation's `session_id`. Routed by session id
alone, every agent's prompt, steps and reply land in the conversation's
transcript, interleaved with the parent's own reply.

## Frames

- The production driver gives each Job turn a sink that adds
  `data.job_id` (the Job's execution id) to every `chat_response` frame.
  Conversation turns keep the plain sink; other frame types pass through
  unchanged.
- The client sends a frame with `job_id` to the sub-agent path and never
  to the conversation's handlers. The runtime bridge
  (`wsHandleChatResponse`) ignores it as well.
- Job turns use the admission ids `<job>_user` / `<job>_user_reply`. A
  follow-up Job's `job_status.parent_msg_id` is the previous
  `<job>_user_reply`, so the client maps every Job to the **first** Job
  of its agent. All of an agent's turns share the store key
  `<session_id>#sub-agent:<first job id>`. Older spawns without a Job id
  key by their branch head.
- Before a Job's reply streams, the client adds its prompt row. The text
  comes from the spawn card's prompt or from `job_status`'s
  `prompt_summary`.

## Transcript load

`load_sub_agent_transcript {session_id, job_id | head_id}` replies with
`sub_agent_transcript {head_id, messages}` and does not move the session
head. The server:

1. resolves the head from the Job's execution input when only `job_id` is
   given;
2. follows the newest user/assistant child from that head to the branch
   tip, which reaches later messages sent to the agent;
3. returns that branch's user and assistant rows in branch order, not
   storage order. A reply placeholder can be written before its prompt.

A finished Job records its reply as `head_id` on the Job and on its spawn
card. The canonical driver returns the turn runner's `TurnResult`, which
names that reply `assistant_msg_id`. A turn that raised returns no result,
so the reply id the Job was admitted with is used.

The client replaces the agent's rows with the loaded ones and keeps any
live rows the load did not include. It reloads when a Job of the same
agent reaches a terminal status.

## Card

- **Header:** bot glyph, "N sub-agents", and a status note (running /
  failed / cancelled / done). While the selected agent runs, the header
  also shows Cancel (through `execution.cancel`).
- **Tabs:** one pill per agent. The name, after its status dot, opens the
  agent in the card; clicking it again closes it. The card opens
  collapsed. A small round **↗** at the pill's right end, styled like the
  address bar's open-in-browser button, shows that agent in the main view.
  It checks out the agent's newest reply, and the sub-agent branch banner
  there leads back. The target is the tip from the agent's loaded
  transcript (loaded on click if needed), and falls back to the spawn
  card's `head_id`.
- **Body:** an inset well at most `min(520px, 60vh)` tall.
  - Each prompt is a raised mini card labelled *Task* or *Message*. It
    drops the `[task from …]` / `[message from …]` receipt line and is
    clamped to 3 lines until clicked.
  - Each reply is an `AssistantBubble` in `embedded` mode: no header and
    no action footer.
  - A running agent opens at its newest output and follows it unless the
    reader scrolls up. A finished agent opens at its task.
- The timeline's sub-agent step rows stay as they are; the card adds the
  agent's conversation and does not replace the step rows.

## The way back

On an agent's branch the transcript shows the sub-agent branch banner:
the agent's name and **Back to main conversation**. It is the only way
back there; the Spawned-from card above the branch's first prompt stays
out while that branch is the one on screen, since it would repeat the
banner. The banner returns to the newest turn below the spawning reply,
not to the spawning reply itself, which would hide later turns.

A bounded session load ships no graph, so `session_loaded` carries
`spawned_branch {root_id, caller_id, back_target, first_reply, label}`
whenever the head is on a spawn branch (and `null` otherwise). The
branch root is the user row with `source=agent_spawn` and no
predecessor; its `caller` is the spawning reply. The root's
`spawned_from` annotation needs no pointer head either: a Job spawn's
root is found the same way, and its label comes from the spawn card with
the matching `job_id`. A run stopped mid-call writes no spawn card, so
the label then falls back to the `description` of the spawning reply's
`agent` call whose prompt opened the branch.

