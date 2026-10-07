"""Bound failed planner attempts while retaining their concrete diagnosis."""
from __future__ import annotations


class PlannerFailures:
    def __init__(self):
        self.count = 0
        self.frame_id = None

    def record(self, result, frame_id):
        if not isinstance(result, dict) or (result.get('ok') is not False and result.get('passed') is not False):
            self.count = 0
            self.frame_id = None
            return None
        self.count = self.count + 1 if frame_id == self.frame_id else 1
        self.frame_id = frame_id
        if self.count < 3:
            return None
        reason = str(result.get('reason_code') or ('assertion_not_met' if result.get('passed') is False else 'tool_error'))
        evidence = result.get('evidence') or {}
        detail = (f"Verification did not satisfy {evidence.get('assertion')}: {evidence.get('value')}"
                  if result.get('passed') is False else reason)
        message = str(result.get('message') or detail)
        return {'reason_code': reason,
                'summary': f'Browser planner stopped after {self.count} failed attempts on the same observation: {message}'}


def rejected_tool(runtime):
    """Retain Runtime gate/execution errors that never reached the controller."""
    for block in reversed(getattr(runtime, 'last_blocks', ())):
        if isinstance(block, dict) and block.get('tool') == 'browser_page' and block.get('is_error'):
            return {'ok': False, 'reason_code': 'tool_execution_failed',
                    'message': str(block.get('result') or 'Browser tool execution was rejected.')[:2000]}
    return None
