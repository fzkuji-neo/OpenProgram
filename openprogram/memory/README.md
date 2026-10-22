# `openprogram/memory/`

Persistent, machine-wide memory for OpenProgram agents.

**Design doc:** [`docs/reference/design/memory/overview.md`](../../docs/reference/design/memory/overview.md).
Read that first — this README is a navigation aid for working in the
directory, not a substitute.

## TL;DR

Memory is a workspace of Markdown files under `<state>/memory/`:

1. `sources/` — the append-only evidence record: what was said, archived
   verbatim, written only by the runtime.
2. `topics/**/*.md` — the editable semantic memory, one file per subject.
   Every paragraph ends in a stable `^block-id` and cites a footnote
   pointing at the source it rests on.
3. `MEMORY.md` — the entry point injected into every session: a map of the
   workspace kept by the memory agents, then a core section rendered from
   `topics/core.md` (only trusted blocks, within `core_max_tokens`).

`timeline/`, `recent_events.jsonl` and `relations.json` are derived and
rebuilt after every write. Memory does not own scheduled work. Scheduler tasks
may keep stable `workspace_id` + `memory_id` references to Topic blocks and
resolve their current content at execution time. A legacy `commitments.jsonl`
file is read only by the one-time Scheduler migration.

Writing happens in the background, not in the conversation: turns
accumulate and are written once there is roughly 16k tokens' worth, and
a nightly pass rewrites what has landed.

Three features sit behind their own settings, all under `memory.*`:
hybrid recall tuning (`retrieval.hybrid.*`), a project's own memory read
beside the personal one (`layers.*`), and a self-check after each write
(`writer.verify`). The design doc explains each.

## File map

| Path | Role |
|---|---|
| `store.py` | Where the workspace is; migration off the previous layout |
| `backend.py` | `MemoryBackend` ABC and the `<memory-context>` fence |
| `local_backend.py` | `LocalMemoryBackend` — the lifecycle hooks the agent runtime calls |
| `policy.py` | Per-execution memory access: modes, spaces, the commit guard |
| `project_layer.py` | A project's own memory: which one, when it is read, routing writes to it |
| `writing.py` | Accumulate, write, verify, reorganize |
| `scheduler.py` | Daemon thread; the 03:00 reorganize of every space and project |
| `session_watcher.py` | Writes a session's remainder once it goes idle |
| `checkpoints.py` | Five-minute Git checkpoints for manual edits |
| `references.py` | Stable references to Topic blocks, for the Scheduler |
| `source_format.py` | Source archive locations and the v2 framing |
| `workspace_layout.py` | Names the runtime owns inside a workspace |
| `management/` | The write transaction (staging, validation, install) and write verification |
| `retrieval/` | BM25, embedding and hybrid search; layered reads across workspaces |
| `markdown/` | The topic format — blocks, footnotes, links |
| `prompts/` | What the writer, the organizer and the verifier are told |
| `runtime/` | Node marks, thresholds, derived views, writer status, legacy commitment migration parser |
| `agent_runtime/` | The process that performs a write |

## Working here

The writer runs on the user's own login and on the default Agent's model,
or the last used model when that Agent has none, so nothing needs a
separate API key. A write is transactional: it stages, validates
and installs, or it changes nothing.

Two invariants worth knowing before editing:

- **Block IDs are the runtime's.** A `^id` that disappears breaks every
  view and link reaching it, so the writer copies them through and the
  transaction rejects an edit that drops one.
- **`sources/` is append-only.** Topics can be rewritten freely; the
  evidence they cite cannot.
