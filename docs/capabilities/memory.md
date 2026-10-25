# Read and edit Memory

Open **History → Memory**, then select a topic. Documents and Core source
records open in Preview. Choose **Edit** to change Markdown text. There are no
Save, Saved, or Changes controls.

Each edit is immediately retained in this browser's local draft storage and
queued for automatic file persistence. Writes are serialized so an earlier
response cannot overwrite newer typing. Use Cmd+Z or Ctrl+Z to undo, and
Cmd+Shift+Z, Ctrl+Shift+Z, or Ctrl+Y to redo; automatic saving does not clear
this document's undo history while the app stays open.

File persistence and Git history are separate. Manual edits are grouped into
five-minute checkpoints by the server, with a scheduling tolerance of 15 seconds.
The deadline survives server restart and does not depend on keeping the editor
open. The state before a manual editing interval is retained.

Every other change to Memory is a commit of its own, named for what made it:

- each background write, named for the conversation it came from;
- the reorganizing a write triggers, separate from the write;
- each pass of the nightly reorganization, one per file it splits;
- each `memory_update` the agent makes in a conversation, named for that
  conversation;
- edits made outside OpenProgram, for example in the Memory folder opened in
  another editor. They are committed on their own just before the next write
  installs, so restoring an earlier version of a write never takes them with it.

A write that fails its checks changes neither the files nor the history.

**History** lists revisions from newest to oldest with local date and time.
Select one to inspect the added and removed lines. **Restore this version**
restores that document, first recording the current state, then recording the
restoration as a new commit. Existing history is retained, so restoration can
itself be reversed by selecting another version. Restoration preserves valid
source references and refuses to break links from other Memory documents.

Rejected or conflicting writes retain the draft and show the error. **Review
latest** compares the latest saved text with the draft inside History;
**Replace latest with this draft** explicitly retries against that reviewed
version. A further concurrent change is still rejected.

## When automatic writing stops

Conversations reach Memory through a background writer. When its last run
failed, a red strip at the top of Memory says why, when it last wrote, and how
many conversation turns are waiting. The App also shows a notice the first time
it fails, and again only if the reason changes. Turns that could not be written
are retried; a conversation the writer finds nothing worth keeping in counts as
written.

## Format checks

Topic text must retain its source footnotes. A substantive paragraph without
a source-backed record is rejected with `INVALID_TOPIC_FORMAT` before any
write is installed. This also applies to `memory_update` whole-file changes
and patches. Valid cited records and empty topics keep their existing behavior;
a rejected batch does not commit new Sources, derived views or Git history.

The background writer runs the same checks after every file it changes, so it
learns about a broken rule on the edit that broke it and fixes it before its
turn ends. A footnote definition written twice, or one left behind by a
paragraph that was moved or deleted, is removed instead of rejected.

Source footnotes open a read-only source view. If the local original session
was deleted, the view says **Original session deleted** and does not expose its
old source text. No extra source copy is created when deleting a session.
Already-extracted memory remains. This source-availability rule does not rewrite
the existing Memory Git repository. Archiving hides a session, preserves its
content and links, and does not automatically delete it after an age or capacity
threshold.

Agent-specific memory modes and separate spaces are configured in [Agents](agents.md). This editor manages the existing shared memory store.
