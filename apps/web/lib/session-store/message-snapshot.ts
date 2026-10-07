import type { ChatMsg } from './types';
import { validMessageTimestamp } from './message-timestamp';

export function isLiveMessage(message: ChatMsg): boolean {
  return ['streaming', 'running', 'cancelling', 'pending'].includes(message.status ?? '');
}

/** A history request can finish after a newer stream frame. Compare only
 * append-only presentation progress for the same row, never branch membership. */
function hasMissingProgress(current: ChatMsg, incoming: ChatMsg): boolean {
  if (current.content && !incoming.content) return true;
  if (current.thinking && !incoming.thinking) return true;
  const blocks = incoming.blocks ?? [];
  return (current.blocks ?? []).some((block, index) => {
    const next = block.type === 'tool' && block.tool_call_id
      ? blocks.find(b => b.type === 'tool' && b.tool_call_id === block.tool_call_id)
      : blocks[index];
    if (!next || next.type !== block.type) return true;
    if (block.type === 'tool') return block.result != null && next.result == null;
    return (block.text?.length ?? 0) > (next.text?.length ?? 0);
  }) || (current.tools?.length ?? 0) > (incoming.tools?.length ?? 0);
}

export function reconcileMessageSnapshot(current: ChatMsg | undefined, incoming: ChatMsg): ChatMsg {
  if (!current || current.id !== incoming.id || current.role !== 'assistant'
      || incoming.role !== 'assistant' || current.display !== incoming.display) return incoming;
  if (isLiveMessage(incoming) && (!isLiveMessage(current) || hasMissingProgress(current, incoming))) {
    return {
      ...incoming,
      ...current,
      timestamp: validMessageTimestamp(incoming.timestamp) ? incoming.timestamp : current.timestamp,
      // History may supply durable file references even while its text lags.
      turnFiles: incoming.turnFiles ?? current.turnFiles,
    };
  }
  // A terminal envelope/snapshot may omit the trace (for example on error).
  // Keep received steps; explicit nonempty terminal blocks remain authoritative.
  return {
    ...incoming,
    timestamp: validMessageTimestamp(incoming.timestamp) ? incoming.timestamp : current.timestamp,
    blocks: incoming.blocks?.length ? incoming.blocks : current.blocks,
    tools: incoming.tools?.length ? incoming.tools : current.tools,
    thinking: incoming.thinking ?? current.thinking,
    callRoots: incoming.callRoots?.length ? incoming.callRoots : current.callRoots,
    runtimeChildren: incoming.runtimeChildren?.length ? incoming.runtimeChildren : current.runtimeChildren,
    turnFiles: incoming.turnFiles ?? current.turnFiles,
  };
}
