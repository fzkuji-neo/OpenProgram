# Evidence ledger

## Implemented in this checkout

- Qualified tool occurrence fields and serial-group semantics in the agent
  event contract and agent loop.
- Raw-id-safe DAG mapping, exposure-preserving node creation, terminal state
  handling, and recovery metadata.
- Ordered stream snapshots, retry/continuation boundaries, memory-only and
  opaque retention handling, duplicate finish idempotency, and full live
  snapshot content.
- Shared `LlmNodeContent` projection, legacy fallback, recursive children,
  explicit unknown-block placeholders, copy behavior, and public fixture
  coverage.
- Canonical Chinese design document updated to describe the implemented
  contract and its remaining App acceptance boundary.

## Verified commands

- `python -m pytest tests/unit/agent/behavior/test_repeat_fail_breaker.py tests/unit/runtime/execution_stream/test_call_stream_state.py tests/unit/runtime/execution_stream/test_recovery_projection.py tests/component/webui/execution/test_goal_execution_projection.py tests/unit/programs/dag/test_runtime_exec_dag.py tests/unit/programs/runtime/test_runtime_tool_adaptation.py tests/contracts/agent/test_agent_tool.py -q` — 69 passed.
- `python -m pytest tests/unit/programs/dag/test_function_dag_exit_node.py tests/unit/programs/runtime/test_tools_runtime.py -q` — 88 passed.
- `node --no-warnings --experimental-strip-types --test apps/web/tests/execution/goal-chip.test.mjs` — 29 passed.
- `npm run check --workspace apps/web` — the run reached `check:multi-draft` and
  stopped because the shared `node_modules` symlink has no installed `katex`
  package, although `apps/web/package.json` and `package-lock.json` declare it.
  The targeted public fixture below passed; parent integration should rerun the
  full check with the workspace dependencies installed.
- `node --no-warnings --experimental-strip-types --test
  apps/web/tests/execution/goal-chip.test.mjs` — 29 passed, including the
  nested-content fixture and the legacy-copy regression.
- `ruff check` on all modified Python files — passed.
- `python -m scripts.docs_site.checklinks` — 0 broken links.
- `git diff --check` — passed.
- `python -m py_compile` on all modified Python runtime/event/history/provider files — passed.

## Known boundary

The parent must run the complete web check and the default `/Applications/OpenProgram.app`
acceptance on profile/port `18100`. Global web TypeScript output in the shared
environment contains unrelated missing-dependency baseline errors; modified
file filtering is not a replacement for the parent build gate.
