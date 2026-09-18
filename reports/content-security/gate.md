# Handoff gate

Status: stable implementation candidate, pending parent integration and App
acceptance.

Required final evidence before merge:

- Backend selected tests include stream state, projection, recovery, agent
  event occurrence, and hidden exposure tests.
- Web tests include the shared component fixture and legacy copy behavior.
- `ruff check` on modified Python files, `python -m scripts.docs_site.checklinks`,
  `python -m py_compile`, filtered TypeScript, and `git diff --check` are clean.
- The full web check is dependency-blocked in this checkout because the shared
  `node_modules` symlink is missing declared package `katex`; the targeted web
  fixture passes. Parent reruns it with installed workspace dependencies.
- Parent performs its own static build and default App acceptance with a
  deterministic nested scenario. This branch does not launch the App or
  refresh its worker.

The dependency/security alert inventory and remediation are owned by the
parent task and are intentionally absent from this implementation ledger.
