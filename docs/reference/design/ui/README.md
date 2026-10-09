# Web UI

Web UI surfaces — the surface system, indicator dots, attachment handling, chat-turn visuals, and GUI-agent context flow.

- [`invariants.md`](invariants.md) — cross-module UI invariants (walk the list before touching related modules)
- [`chat-transcript-follow.html`](chat-transcript-follow.html) — unified transcript follow: one attach/detach policy for send, stream, Jump to latest, session switch, and history windows
- [`chat-turn-visual-spec.html`](chat-turn-visual-spec.html) — chat-turn visual spec (execution timeline, file-change summary surface, manual function runs, and message minimap); file-history semantics live in the [canonical runtime design](../runtime/operations/file-management.html)
- [`tool-group-summary.html`](tool-group-summary.html) — header of a folded run of tool calls: summary grammar, +N −M change badge, running tense, and the turn-level summary decision
- [`interaction-feedback.md`](interaction-feedback.md) — the 0ms interaction-feedback rule (optimistic state first, data backfills)
- [`turn-occupancy.md`](turn-occupancy.md) — stop, send-queue, and session-slot occupancy (released on cancel intent)
- [`state-layer.md`](state-layer.md) — web state layer: one store instance per session, with genuinely shared data global
- [`center-tabs-and-split-layout.html`](center-tabs-and-split-layout.html) — authoritative single-tab and composite split-tab lifecycle, rendering, persistence, and transfer design
- [`built-in-browser.html`](built-in-browser.html) — built-in browser home, browser-profile import, compact History, and the four-entry new-pane launcher
- [`browser-extensions.html`](browser-extensions.html) — product decision not to support Chrome/Edge extension installation or management, retained browser capabilities, and the inert legacy-data boundary
- [`integrated-terminal.html`](integrated-terminal.html) — real PTY terminal and direct local Claude Code launcher
- [`composer-local-attachment-paths.html`](composer-local-attachment-paths.html) — local attachment path preservation from the composer to model context
- [`composer-responsive-controls.html`](composer-responsive-controls.html) — responsive composer controls and compact-state interaction contract
- [`composer-tool-profile-menu.html`](composer-tool-profile-menu.html) — Options (+) menu on the shared menu grammar; Tools action and profile submenu behavior
- [`effort-picker.html`](effort-picker.html) — the effort card: lavender level name and `?` help tip in the header, a neutral stepped track with a highest-level animated square field, the thumb's level tip, and the Recommended caption
- [`programs-source-categories.html`](programs-source-categories.html) — Programs grouping and source-category behavior
- [`composer-interaction-modes.md`](composer-interaction-modes.md) — composer interaction modes
- [`attachment-handling.html`](attachment-handling.html) — complete attachment design: storage, admission, delivery, recovery, and acceptance
- [`chat-attachments.html`](chat-attachments.html) — chat attachments both ways: what the transcript shows, how the agent hands a file back, how a readable file opens
- [`gui-agent.html`](gui-agent.html) — GUI agent entry, state machine, result contract, and implementation status
- [`agent-control-overlay.html`](agent-control-overlay.html) — status pill and agent pointer drawn over a window or page the agent controls: placement, wording, motion, accent colour, and input safety
- [`indicator-dots.md`](indicator-dots.md) — indicator dots
- [`git-folder-pills.md`](git-folder-pills.md) — per-folder git pill in the composer: branch, change counts, branch switch, worktrees, pull requests
- [`hover-tips.md`](hover-tips.md) — composer hover tips: one `HoverTip` + `TipBody` layout, title with current value, muted detail line
- [`icons.md`](icons.md) — icon system: which family goes where (Solar in the composer, animated line icons in the chrome, lucide elsewhere), motion contract, attribution
- [`surface-system.md`](surface-system.md) — surface system
- [`theme-system.html`](theme-system.html) — authoritative theme entry, complete token contract, component consumption, and desktop-overlay propagation
- [`settings-collapsible-columns.html`](settings-collapsible-columns.html) — independent 49px collapse for the app and Settings nav; Providers list stays expanded with a full-width search field
- [`avatar-randomization.html`](avatar-randomization.html) — shared Agent/User avatar picker: type first, then same-style variants or letter fields
- [`web-styles.md`](web-styles.md) — web style organization (one component, one file; directories mirror the component tree)
- [`window-state.md`](window-state.md) — desktop window bounds, maximize/fullscreen, and titlebar resize hit-testing
- [`window-lifecycle.md`](window-lifecycle.md) — one main window: launch, Dock activate, and second-instance share a single create
