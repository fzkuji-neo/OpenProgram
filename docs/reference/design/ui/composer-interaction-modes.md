# Composer and user decision output

The composer edits ordinary messages and user-opened function forms. Runtime questions, confirmations, forms and approvals are separate output cards in the conversation. A pending decision never replaces the composer, clears its draft, closes its function form, changes its send action, or takes its focus.

## Ordinary messages and function forms

The composer has two modes: `idle` and `fn-form`. Selecting a registered function opens `FunctionForm`; required fields and validation remain inside that form. Its transition, close action and outgoing-form animation belong to the composer. A pending decision does not cancel a function form.

A complete registered `name(parameter=literal, ...)` expression in ordinary input uses the same invocation dispatcher and schema validation as the form. Explanatory text, partial expressions and fenced code remain ordinary chat text. While execution is running, normal messages retain the configured queue or steer behavior. Empty input retains the stop action.

## Decision output cards

`DecisionOutputs` renders session-scoped `PendingDecision` requests in the message stream and split panes. Each keyed card reuses `QuestionMode` for `ask`, `confirm`, `ask_many`, `form` and `approval`. Answer fields and navigation are local to the card. New questions do not autofocus. Multiple questions remain independently addressable in stable presentation order.

Text and choice questions show their own input and submit controls. Multi-question requests collect ordered answers; forms submit field objects. Approval cards retain the available scopes, operation details and explicit allow/deny actions. Asking a question does not authorize an operation.

Submission immediately displays the actual answer and a sending state inside the card. Only a matching applied command confirms delivery. Unknown outcomes retain the original command identifier and payload for retry, show the available error code, and never imply success. Explicit rejections reconcile the current request before another answer. A closed request is not displayed as an accepted answer. Confirmed answers and declines remain as session UI receipts; the normal composer draft is unaffected.

Receipts are in-memory presentation state, not Workflow checkpoints. Refresh reloads canonical pending questions; this change does not add historical receipt persistence. Requests remain bound to their original session, execution, generation and version even when the user changes tabs.

## Discussion and events

An explicit discussion action retains its own feedback input. It first confirms decline of the pending request, then queues the contextual discussion in the owning conversation. An unconfirmed decline cannot send discussion or permit execution. Ordinary composer messages do not implicitly decline a question or become its answer.

UI-only settings use direct store updates. A one-shot user action uses a correlated request and response. Runtime questions are broadcast events projected into the pending-decision store; command acknowledgement remains authoritative. Event arrival alone is not a receipt for the user's answer.

`question.asked` and reconnect snapshots supply canonical targets. `useWaitAnswer` submits execution commands and owns acknowledgement state; `QuestionMode` owns answer fields; `DecisionOutputs` owns output placement. Backend live Workflow questions continue in the original process. Existing predeclared Agent waits retain their continuation contract.

## Acceptance

Verify a pending question alongside a populated composer: the question is outside the composer, the draft and focus remain, and normal Send remains ordinary message submission. Click the card's submit button and verify immediate answer feedback, matching acknowledgement, retained receipt, unchanged composer draft, session isolation, retry identity and native App behavior.

See [user input requests](../runtime/operations/user-input-requests.md) and [execution control](../runtime/execution/control.html#decision-output).
