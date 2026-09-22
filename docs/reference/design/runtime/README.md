# Runtime

Agent execution runtime — the run loop, worktrees, async tasks, streaming/resume, the DAG model, and revert layers.

- [`dag/overview.md`](dag/overview.md) — **authoritative**: the execution-record data model (one single graph / three node roles user·llm·code / caller+predecessor edges / render_context retrieval)
- [`dag/rendering.md`](dag/rendering.md) — **authoritative rendering spec**: layout / edges / legend / default visibility, 12 scenarios
- [`dag/branch-collaboration.md`](dag/branch-collaboration.md) — branch collaboration (communication / dispatch / merge) design and implementation steps
- [`execution/agent-call-flow.md`](execution/agent-call-flow.md) — the call-flow skeleton (turn / loop, orthogonal to the node model)
- [`execution/agent-worktree.md`](execution/agent-worktree.md)
- [`execution/async-job-lifecycle.md`](execution/async-job-lifecycle.md)
- [`execution/execution-control.html`](execution/execution-control.html) — **authoritative**: unified pause, continue, step, steering, cancellation, checkpoint, revision, and recovery contract
- [`execution/dispatcher-split.md`](execution/dispatcher-split.md) — break `agent/dispatcher.py` into a responsibility-scoped package (no-1000-line rule)
- [`operations/file-management.html`](operations/file-management.html) — authoritative file attribution, Review, Undo, Restore, branch alignment, and multi-agent ownership
- [`overview.md`](overview.md)
- [`session/`](session/) — the session subsystem: data model, storage, naming, listing, lifecycle, broadcast
- [Nested `llm()` streaming design](https://github.com/fzkuji-neo/OpenProgram/blob/main/docs/reference/design/runtime/agentic-llm-streaming.zh.html) — **Full design** (zh): per-node token streaming (protocol, FE buffer, persistence, cancel/reconnect, in-process+subprocess)
- [`operations/streaming-resume.md`](operations/streaming-resume.md)
- [`operations/user-input-requests.md`](operations/user-input-requests.md) — pause a running function to ask the user (`runtime.ask`/`confirm`), question registry + WS/REST protocol + subprocess bridge
- [`agent-collaboration.md`](agent-collaboration.md) — **authoritative**: agent collaboration as one cross-branch communication primitive — the four domains, the tool surface, the three budgets ([the tool surface rendered](agent-collab-architecture.html), [the eight reference implementations compared](agent-collab-comparison.html))
- [`sandbox-architecture.html`](sandbox-architecture.html) — the canonical execution-security design: authority tiers, permission modes and approval, sandbox enforcement, framework comparison, and implementation evidence. [`permission-model.md`](sandbox-architecture.html) and [`sandbox.md`](sandbox-architecture.html) remain stable link targets.

- [嵌套 LLM 节点内容（聊天式有序块）](https://github.com/fzkuji-neo/OpenProgram/blob/main/docs/reference/design/runtime/nested-llm-node-content.zh.html)
