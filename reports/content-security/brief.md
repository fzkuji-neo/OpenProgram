# Completion brief

The stream protocol treats `occurrence_id` as the idempotency key. Raw
provider `tool_call_id` remains display metadata and may repeat in later
provider rounds. Tool refs point to DAG nodes and never copy result payloads.

The current Python dispatcher executes tool calls serially and therefore emits
no `group_id`. The reducer and UI still accept explicit groups from a future
concurrent dispatcher; adjacency never creates a group.

Visible content is complete in live and durable snapshots subject to the
explicit retention policy. The bounded `preview_text` and
`preview_reasoning` fields remain compatibility summaries; the ordered
snapshot is the source used for refresh/recovery.

Hidden agentic tools do not precreate a node or persist arguments/results.
Legacy block projections retain tool rows and archived child tools. Unknown
block kinds render an explicit placeholder, and missing/failed/cancelled refs
cannot be reported as completed.

The DAG detail path reconstructs caller children from the flat graph cache and
normalizes their ids before passing the tree to the same renderer, so a detail
panel opened from the execution graph can resolve the same tool refs as a chat
tree row.
