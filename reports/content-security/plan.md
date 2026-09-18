# Nested content completion plan

Scope: complete the nested LLM ordered-content contract in this isolated
checkout. The parent task owns dependency/security remediation and final
integration.

The implementation gate is bounded to five public boundaries:

1. Provider tool events carry a qualified occurrence identity, declared DAG
   visibility, and an explicit concurrency group only when a real concurrent
   dispatcher supplies one.
2. The history writer maps one occurrence to one DAG tool node, preserves the
   declared `io`/`llm`/`full`/`hidden` exposure policy, and leaves unresolved
   refs non-terminal.
3. `CallStreamState` preserves ordered blocks across normal tool continuation,
   retry attempts, duplicate events, owner loss, and live/durable snapshots.
4. The shared React component renders Markdown, thinking, tool refs, explicit
   unsupported placeholders, recursive LLM children, and legacy no-stream
   children from the same public projection.
5. Tests cover a deterministic nested scenario with repeated raw call ids,
   sibling nested functions, hidden payloads, failure/cancellation states,
   explicit parallel fixture grouping, and owner-gone recovery.

No real provider, messaging, external side effect, visible dev profile, or
default App refresh is part of this subtask. The parent performs final App
acceptance and integration.
