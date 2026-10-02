import sys
from pathlib import Path
import pytest
from types import SimpleNamespace
from unittest.mock import patch
HARNESS_ROOT = Path(__file__).resolve().parents[4] / 'openprogram/programs/applications/gui_harness'
if not (HARNESS_ROOT / 'gui_harness/main.py').is_file():
    pytest.skip('gui_harness checkout is not present', allow_module_level=True)
sys.path.insert(0, str(HARNESS_ROOT))
from gui_harness.main import gui_agent
from gui_harness.tasks import capability_loop, result as workflow_result
from openprogram.programs.gui_harness_bridge import install_gui_harness_web_use
from openprogram import system_access

def test_task_only_browser_does_not_require_desktop_access():
    decisions=iter([{'call':'browser_use','args':{'task':'Read bound browser page'}},
                    {'call':'terminal','args':{'status':'succeeded','reason':'Browser verified'}}])
    calls=[]
    def plan(**kwargs):
        calls.append(kwargs)
        return next(decisions)
    with patch.object(system_access, 'report', return_value={'platform':'Darwin','capabilities':[
        {'id':'screen_recording','status':'not_granted','can_request':True},
        {'id':'accessibility','status':'not_granted','can_request':True}]}), \
         patch.object(capability_loop,'capability_status',return_value={
             'computer_use':{'available':False},'browser_use':{'available':True},'vm_use':{'available':False}}), \
         patch.object(capability_loop,'plan_next_capability',side_effect=plan), \
         patch.object(capability_loop,'call_capability',return_value={
             'status':'succeeded','success':True,'completion_verified':True,'summary':'Bound page read'}), \
         patch.object(workflow_result,'conclusion',return_value={'summary':'Bound page read'}), \
         patch.object(workflow_result,'save_workflow_record'):
        public=install_gui_harness_web_use(gui_agent)
        assert system_access.access_manifest_for_tool('gui_agent', {'task':'Read browser only'}) is None
        result=public(task='Read browser only', runtime=SimpleNamespace())
    assert result['status']=='succeeded', result
    assert len(calls)==2


@pytest.mark.parametrize('desktop', [
    {'available':False, 'missing_dependencies':['AppKit'], 'system_access':[
        {'id':'accessibility', 'status':'not_granted'}]},
    {'available':False, 'missing_dependencies':[], 'system_access':[
        {'id':'accessibility', 'status':'unavailable'}]},
])
def test_unavailable_native_capability_does_not_request_permissions(desktop, monkeypatch):
    decisions = iter([
        {'call':'computer_use', 'args':{'task':'Inspect unavailable app'}},
        {'call':'terminal', 'args':{'status':'failed', 'reason':'Native capability unavailable'}},
    ])
    monkeypatch.setattr(capability_loop, 'capability_status', lambda **kwargs: {
        'computer_use':desktop, 'browser_use':{'available':True}, 'vm_use':{'available':False}})
    monkeypatch.setattr(capability_loop, 'plan_next_capability', lambda **kwargs: next(decisions))
    monkeypatch.setattr(system_access, 'required_access_state', lambda *args: pytest.fail('Unavailable dependency must not request access'))
    monkeypatch.setattr(capability_loop, 'call_capability', lambda *args, **kwargs: pytest.fail('Unavailable capability must not dispatch'))
    monkeypatch.setattr(workflow_result, 'conclusion', lambda **kwargs: {'summary':'Native capability unavailable'})
    monkeypatch.setattr(workflow_result, 'save_workflow_record', lambda *args: None)
    public = install_gui_harness_web_use(gui_agent)
    result = public(task='Inspect app', runtime=SimpleNamespace())
    assert result['status'] == 'failed'
    assert result['history'][0]['output']['reason_code'] == 'capability_unavailable'


@pytest.mark.parametrize('resume_state', ['ready', 'expired', 'stale_owner', 'uncertain_effect'])
def test_selected_desktop_suspends_before_effect_and_reuses_committed_browser_result(tmp_path, monkeypatch, resume_state):
    from openprogram.agentic_programming.continuation import FunctionSystemAccessRequired, function_execution
    from openprogram.execution import AttemptStore, ExecutionStore
    from openprogram.execution.model import CapabilitySet
    from openprogram.execution.effects import EffectStore
    from openprogram.programs import _gui_operations
    clock = [1000.0]
    monkeypatch.setattr(_gui_operations, 'time', SimpleNamespace(time=lambda: clock[0]))
    store = ExecutionStore(tmp_path / 'executions.db')
    revision = store.create_revision(manifest={'entrypoint': 'gui_agent'})
    execution = store.create_execution(execution_id='execution', run_id='run', session_id='session',
        revision_id=revision.revision_id, capabilities=CapabilitySet(pause=True,
        safe_point_kinds=('function.step.after',), state_schema_version=1))
    attempts = AttemptStore(store)
    leased, reserved = attempts.lease('execution', expected_version=execution.status_version,
        owner_id='worker', ttl_seconds=30)
    active, running = attempts.activate(leased.attempt_id, generation=leased.generation,
        expected_execution_version=reserved.status_version)
    granted = False
    plans, effects = [], []
    def report():
        return {'platform':'Darwin','capabilities':[{'id':'accessibility',
            'status':'granted' if granted else 'not_granted','can_request':True}]}
    def plan(**kwargs):
        plans.append(len(kwargs['history']))
        if not kwargs['history']:
            return {'call':'browser_use','args':{'task':'Read page'}}
        if len(kwargs['history']) == 1:
            return {'call':'computer_use','args':{'task':'Inspect app'}}
        return {'call':'terminal','args':{'status':'succeeded','reason':'Verified'}}
    def effect(call, *args, **kwargs):
        effects.append(call)
        if call == 'computer_use' and resume_state == 'uncertain_effect':
            raise KeyboardInterrupt('Simulated process loss after native effect')
        return {'status':'succeeded','success':True,'completion_verified':True,'summary':call}
    monkeypatch.setattr(system_access, 'report', report)
    monkeypatch.setattr(capability_loop, 'capability_status', lambda **kwargs: {
        'computer_use':{'available':granted, 'missing_dependencies':[], 'system_access':report()['capabilities']},
        'browser_use':{'available':True},'vm_use':{'available':False}})
    monkeypatch.setattr(capability_loop, 'plan_next_capability', plan)
    monkeypatch.setattr(capability_loop, 'call_capability', effect)
    monkeypatch.setattr(workflow_result, 'conclusion', lambda **kwargs: {'summary':'Verified'})
    monkeypatch.setattr(workflow_result, 'save_workflow_record', lambda *args: None)
    public = install_gui_harness_web_use(gui_agent)
    with pytest.raises(FunctionSystemAccessRequired) as suspended:
        with function_execution(store, attempt_id=active.attempt_id, generation=active.generation,
                call_key='gui-call', publish_pause=False):
            public(task='Read page then inspect app', max_seconds=10, runtime=SimpleNamespace(live_only=object()))
    assert suspended.value.call_key == 'gui-call'
    assert plans == [0, 1]
    assert effects == ['browser_use']
    assert not EffectStore(store).list_unresolved('execution')
    granted = True
    if resume_state == 'expired':
        clock[0] += 11
    if resume_state == 'stale_owner':
        from openprogram.execution.attempts import AttemptConflict
        with store._transaction() as connection:
            connection.execute('UPDATE attempts SET lease_expires_at=0 WHERE attempt_id=?', (active.attempt_id,))
        with pytest.raises(AttemptConflict, match='lease'):
            with function_execution(store, attempt_id=active.attempt_id, generation=active.generation,
                    call_key='gui-call', publish_pause=False):
                public(task='Read page then inspect app', max_seconds=10, runtime=SimpleNamespace())
        assert plans == [0, 1]
        assert effects == ['browser_use']
        return
    if resume_state == 'uncertain_effect':
        from openprogram.agentic_programming.continuation import FunctionCompatibilityError
        with pytest.raises(KeyboardInterrupt, match='process loss'):
            with function_execution(store, attempt_id=active.attempt_id, generation=active.generation,
                    call_key='gui-call', publish_pause=False):
                public(task='Read page then inspect app', max_seconds=10, runtime=SimpleNamespace())
        with pytest.raises(FunctionCompatibilityError, match='reconciliation'):
            with function_execution(store, attempt_id=active.attempt_id, generation=active.generation,
                    call_key='gui-call', publish_pause=False):
                public(task='Read page then inspect app', max_seconds=10, runtime=SimpleNamespace())
        assert plans == [0, 1]
        assert effects == ['browser_use', 'computer_use']
        assert len(EffectStore(store).list_unresolved('execution')) == 1
        return
    with function_execution(store, attempt_id=active.attempt_id, generation=active.generation,
            call_key='gui-call', publish_pause=False):
        result = public(task='Read page then inspect app', max_seconds=10, runtime=SimpleNamespace(live_only=object()))
    if resume_state == 'expired':
        assert result['status'] == 'failed'
        assert result['reason_code'] == 'timeout'
        assert plans == [0, 1]
        assert effects == ['browser_use']
        return
    assert result['status'] == 'succeeded'
    assert plans == [0, 1, 2]
    assert effects == ['browser_use', 'computer_use']
