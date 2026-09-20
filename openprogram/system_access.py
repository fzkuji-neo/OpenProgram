"""Live execution-host access diagnostics. Reading status never requests access.

OS access is independent of tool approval. Optional capabilities are advisory;
absence must not make a headless installation unhealthy.
"""
from __future__ import annotations

import importlib
import json
import logging
import os
import platform
import socket
from pathlib import Path
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from types import MappingProxyType

_REQUEST_LOCK = threading.Lock()
_log = logging.getLogger(__name__)
_NATIVE_PROBE_SCHEMA = 1
SYSTEM_ACCESS_SCHEMA = 2
SYSTEM_ACCESS_VERSION = 2
_NATIVE_PROBE_TIMEOUT = 5.0
_NATIVE_REQUEST_TIMEOUT = 120.0
_NATIVE_PROBE_MAX_OUTPUT = 16 * 1024
_NATIVE_PROBE_SCRIPT = (
    'from openprogram.system_access import _native_probe_entry; '
    '_native_probe_entry()'
)
@dataclass(frozen=True)
class CapabilitySpec:
    """The single protocol definition for a host capability.

    A spec is deliberately declarative.  A missing implementation is reported
    as ``unknown``/``unsupported`` and is never interpreted as a grant.
    """

    id: str
    label: str
    label_zh: str
    category: str
    subject: str
    request_mode: str
    platforms: tuple[str, ...] = ('Darwin',)
    optional: bool = True
    operations: tuple[str, ...] = ()
    module: str | None = None
    check_method: str | None = None
    request_method: str | None = None
    settings_pane: str | None = None
    settings_label: str = 'Privacy & Security'
    usage_key: str | None = None
    entitlement: str | None = None
    identity_role: str | None = None
    identity_application: str | None = None
    identity_bundle_id: str | None = None
    tcc_service: str | None = None
    package_declarations: tuple[str, ...] = ()


# Keep the two legacy rows first: old clients display the first row and their
# wire shape remains unchanged.  All other host capabilities are represented
# here even when the current platform backend is declaration-only.
_CAPABILITY_SPECS = (
    CapabilitySpec(
        'screen_recording', 'Screen recording', '屏幕录制', 'desktop', 'containing_app',
        'native', operations=('gui_agent:desktop',), module='Quartz',
        check_method='CGPreflightScreenCaptureAccess',
        request_method='CGRequestScreenCaptureAccess',
        settings_pane='Privacy_ScreenCapture',
        settings_label='Screen & System Audio Recording',
        identity_role='containing_app',
        identity_application='/Applications/OpenProgram.app',
        identity_bundle_id='ai.openprogram.desktop', tcc_service='ScreenCapture',
    ),
    CapabilitySpec(
        'accessibility', 'Desktop control', '桌面控制', 'desktop', 'runtime', 'native',
        operations=('gui_agent:desktop',), module='ApplicationServices',
        check_method='AXIsProcessTrusted',
        request_method='AXIsProcessTrustedWithOptions',
        settings_pane='Privacy_Accessibility', settings_label='Accessibility',
        identity_role='runtime',
        identity_application='/Applications/OpenProgram.app/Contents/Resources/runtime/OpenProgram.app',
        identity_bundle_id='ai.openprogram.runtime', tcc_service='Accessibility',
    ),
    CapabilitySpec(
        'apple_events', 'Automation', '自动化', 'integrations', 'target_app', 'targeted',
        operations=('apple_events:*',), settings_pane='Privacy_Automation',
        settings_label='Automation', usage_key='NSAppleEventsUsageDescription',
        entitlement='com.apple.security.automation.apple-events',
        package_declarations=('NSAppleEventsUsageDescription', 'com.apple.security.automation.apple-events'),
    ),
    CapabilitySpec(
        'calendar', 'Calendar', '日历', 'integrations', 'containing_app', 'settings',
        operations=('calendar:*',), settings_pane='Privacy_Calendars',
        settings_label='Calendars', usage_key='NSCalendarsUsageDescription',
        package_declarations=('NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription'),
    ),
    CapabilitySpec(
        'reminders', 'Reminders', '提醒事项', 'integrations', 'containing_app', 'settings',
        operations=('reminders:*',), settings_pane='Privacy_Reminders',
        settings_label='Reminders', usage_key='NSRemindersUsageDescription',
        package_declarations=('NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription'),
    ),
    CapabilitySpec(
        'file_read', 'File read', '文件读取', 'storage', 'user_selected_path', 'operation',
        platforms=('Darwin', 'Linux', 'Windows'), operations=('file:read',),
        settings_label='Files and Folders',
    ),
    CapabilitySpec(
        'file_write', 'File write', '文件写入', 'storage', 'user_selected_path', 'operation',
        platforms=('Darwin', 'Linux', 'Windows'), operations=('file:write',),
        settings_label='Files and Folders',
    ),
    CapabilitySpec(
        'microphone', 'Microphone', '麦克风', 'media', 'containing_app', 'settings',
        operations=('microphone:*',), settings_pane='Privacy_Microphone',
        settings_label='Microphone',
    ),
    CapabilitySpec(
        'camera', 'Camera', '摄像头', 'media', 'containing_app', 'settings',
        operations=('camera:*',), settings_pane='Privacy_Camera',
        settings_label='Camera',
    ),
)

CAPABILITY_REGISTRY = MappingProxyType({spec.id: spec for spec in _CAPABILITY_SPECS})


def capability_registry() -> tuple[CapabilitySpec, ...]:
    """Return the immutable registry in protocol order."""
    return _CAPABILITY_SPECS


def capability_spec(capability: str) -> CapabilitySpec:
    try:
        return CAPABILITY_REGISTRY[str(capability)]
    except (KeyError, TypeError) as exc:
        raise ValueError(f'Unknown system capability: {capability}') from exc


_PACKAGE_USAGE_TEXT = {
    'NSAppleEventsUsageDescription': 'OpenProgram controls applications on your Mac to carry out tasks you request.',
    'NSCalendarsUsageDescription': 'OpenProgram accesses your calendars to carry out tasks you request.',
    'NSCalendarsFullAccessUsageDescription': 'OpenProgram reads and updates calendar events when you request it.',
    'NSRemindersUsageDescription': 'OpenProgram accesses reminders to carry out tasks you request.',
    'NSRemindersFullAccessUsageDescription': 'OpenProgram reads and updates reminders when you request it.',
}


def package_usage_declarations() -> dict[str, str]:
    """Return the usage strings required by the registry for macOS bundles."""
    keys = {
        key for spec in capability_registry() for key in spec.package_declarations
        if key.startswith('NS')
    }
    missing = keys - _PACKAGE_USAGE_TEXT.keys()
    if missing:
        raise RuntimeError(f'No usage description text for registry keys: {sorted(missing)}')
    return {key: _PACKAGE_USAGE_TEXT[key] for key in sorted(keys)}


def package_entitlements() -> frozenset[str]:
    """Return registry-declared entitlements expected in the signed bundle."""
    return frozenset(
        key for spec in capability_registry() for key in spec.package_declarations
        if key.startswith('com.apple.')
    )


def validate_package_consistency(
    actual_usage: dict[str, str], actual_entitlements: set[str] | frozenset[str],
) -> None:
    """Fail on drift between registry declarations and a built macOS bundle."""
    expected_usage = package_usage_declarations()
    expected_entitlements = package_entitlements()
    if dict(actual_usage) != expected_usage:
        raise RuntimeError(
            f'Package usage declarations drift from registry: '
            f'expected={sorted(expected_usage)}, actual={sorted(actual_usage)}'
        )
    missing_entitlements = set(expected_entitlements) - set(actual_entitlements)
    if missing_entitlements:
        raise RuntimeError(
            f'Package entitlements drift from registry: '
            f'missing={sorted(missing_entitlements)}, actual={sorted(actual_entitlements)}'
        )


def validate_capability_registry() -> None:
    ids = [spec.id for spec in _CAPABILITY_SPECS]
    if len(ids) != len(set(ids)) or any(not item for item in ids):
        raise RuntimeError('System access capability ids must be unique and non-empty.')
    for spec in _CAPABILITY_SPECS:
        if spec.request_mode == 'native' and not (spec.module and spec.check_method):
            raise RuntimeError(f'Native capability {spec.id} has no nonprompting check.')
        if spec.request_mode in {'native', 'settings', 'targeted'} and not spec.settings_pane:
            raise RuntimeError(f'Capability {spec.id} has no settings destination.')
        if spec.identity_role and spec.identity_role not in {'containing_app', 'runtime'}:
            raise RuntimeError(f'Unknown identity role for {spec.id}.')
        if not spec.label or not spec.label_zh:
            raise RuntimeError(f'Capability {spec.id} must have English and Chinese labels.')
        declarations = set(spec.package_declarations)
        if spec.usage_key and spec.usage_key not in declarations:
            raise RuntimeError(f'Capability {spec.id} usage_key is missing from package declarations.')
        if spec.entitlement and spec.entitlement not in declarations:
            raise RuntimeError(f'Capability {spec.id} entitlement is missing from package declarations.')
        for operation in spec.operations:
            if not operation or ':' not in operation:
                raise RuntimeError(f'Invalid operation mapping for {spec.id}.')
    package_usage_declarations()


validate_capability_registry()

# Compatibility view used by the existing native probe tests and old callers.
_MAC = {
    spec.id: (spec.label, spec.module, spec.check_method, spec.settings_label)
    for spec in _CAPABILITY_SPECS if spec.request_mode == 'native'
}


def capability_identity_targets() -> dict[str, dict[str, str]]:
    """Return registry identity metadata without exposing mutable specs."""
    return {
        spec.id: {
            'application': spec.identity_application,
            'bundle_id': spec.identity_bundle_id,
            'role': spec.identity_role,
            'tcc_service': spec.tcc_service,
        }
        for spec in capability_registry()
        if spec.identity_application and spec.identity_bundle_id
    }


def _capability_row(spec: CapabilitySpec, *, status: str, detail: str) -> dict:
    """Build the stable row shape plus registry metadata."""
    settings = (f'Privacy & Security > {spec.settings_label}'
                if spec.settings_pane else 'Use the operation-specific access flow.')
    settings_url = (
        'x-apple.systempreferences:com.apple.preference.security?' + spec.settings_pane
        if spec.settings_pane else None
    )
    instruction = (
        f'On this execution Mac, open System Settings > {settings}. '
        'Authorize the executing application shown by macOS. Return here to check again.'
        if spec.settings_pane else
        'Access is checked when the operation runs. Select the path or target application explicitly.'
    )
    row = {
        'id': spec.id,
        'label': spec.label,
        'label_zh': spec.label_zh,
        'status': status,
        'optional': spec.optional,
        'category': spec.category,
        'setup_group': spec.category,
        'subject': spec.subject,
        'identity_role': spec.identity_role or spec.subject,
        'identity_scope': spec.subject,
        'identity': {
            'role': spec.identity_role or spec.subject,
            'scope': spec.subject,
            'bundle_id': spec.identity_bundle_id,
            'application': spec.identity_application,
        },
        'request_mode': spec.request_mode,
        'settings_available': bool(spec.settings_pane),
        'settings_pane': spec.settings_pane,
        'settings_url': settings_url,
        'operations': list(spec.operations),
        'required_operations': list(spec.operations),
        'instruction': instruction,
        'can_request': status == 'not_granted' and spec.request_mode == 'native',
        'detail': detail,
    }
    if spec.usage_key:
        row['usage_key'] = spec.usage_key
    if spec.entitlement:
        row['entitlement'] = spec.entitlement
    row['package_declarations'] = list(spec.package_declarations)
    return row


def _mac_row(capability: str, *, status: str, detail: str) -> dict:
    """Legacy helper retained for callers that only know the two old ids."""
    return _capability_row(capability_spec(capability), status=status, detail=detail)


def _declaration_row(spec: CapabilitySpec, system: str) -> dict:
    if system not in spec.platforms:
        return _capability_row(
            spec, status='unsupported',
            detail=f'The {spec.label.lower()} backend is not supported on {system}.',
        )
    if spec.request_mode == 'targeted':
        return _capability_row(
            spec, status='unknown',
            detail='Authorization is target-specific; provide the target application to check it.',
        )
    if spec.request_mode == 'operation':
        return _capability_row(
            spec, status='unknown',
            detail='Authorization is scoped to the selected path and is checked by the real operation.',
        )
    return _capability_row(
        spec, status='unknown',
        detail='This capability is declared but no nonprompting backend is available in this runtime.',
    )


def _native_identity() -> dict[str, str]:
    identity = {'executable': str(Path(sys.executable).resolve())}
    try:
        bundle = importlib.import_module('Foundation').NSBundle.mainBundle()
        identity['application'] = str(bundle.objectForInfoDictionaryKey_('CFBundleName') or '')
        identity['bundle_id'] = str(bundle.bundleIdentifier() or '')
        identity['bundle_path'] = str(bundle.bundlePath() or '')
    except Exception:
        _log.debug('native application identity unavailable', exc_info=True)
    return identity


def _native_probe_entry() -> None:
    """Private child entry for nonprompting native checks and explicit requests."""
    request = None
    if len(sys.argv) == 3 and sys.argv[1] == '--request':
        request = sys.argv[2]
        if request not in _MAC:
            raise ValueError('unsupported native capability request')
    elif len(sys.argv) != 1:
        raise ValueError('invalid native probe arguments')

    rows = []
    for capability, (_, module, method, _) in _MAC.items():
        try:
            native = importlib.import_module(module)
            if request == capability:
                spec = capability_spec(capability)
                if capability == 'screen_recording':
                    getattr(native, spec.request_method)()
                else:
                    native.AXIsProcessTrustedWithOptions(
                        {native.kAXTrustedCheckOptionPrompt: True}
                    )
            granted = bool(getattr(native, method)())
            rows.append({
                'id': capability,
                'status': 'granted' if granted else 'not_granted',
                'detail': 'Authorized in the fresh named executor.' if granted
                else 'Not authorized in the fresh named executor.',
            })
        except ImportError as exc:
            rows.append({
                'id': capability,
                'status': 'unavailable',
                'detail': f'Native permission dependencies are missing ({type(exc).__name__}).',
            })
        except Exception as exc:
            rows.append({
                'id': capability,
                'status': 'unknown',
                'detail': f'Fresh native check failed ({type(exc).__name__}).',
            })
    print(json.dumps({
        'schema': _NATIVE_PROBE_SCHEMA,
        'identity': _native_identity(),
        'capabilities': rows,
    }, sort_keys=True), flush=True)


def _native_probe(request_capability: str | None = None, *, timeout: float = _NATIVE_PROBE_TIMEOUT) -> dict | None:
    executable = os.path.abspath(sys.executable)
    identity_executable = str(Path(executable).resolve())
    command = [executable, '-I', '-B', '-c', _NATIVE_PROBE_SCRIPT]
    if request_capability is not None:
        if request_capability not in _MAC:
            raise ValueError('unsupported native capability request')
        command.extend(['--request', request_capability])
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        _log.debug('fresh native access probe failed to start: %s', exc)
        return None
    stdout = result.stdout if isinstance(result.stdout, str) else ''
    if result.returncode != 0 or len(stdout.encode('utf-8', 'replace')) > _NATIVE_PROBE_MAX_OUTPUT:
        _log.debug('fresh native access probe exited unsuccessfully: %s', result.returncode)
        return None
    try:
        payload = json.loads(stdout)
    except (TypeError, ValueError, RecursionError):
        _log.debug('fresh native access probe returned malformed JSON')
        return None
    if not isinstance(payload, dict) or payload.get('schema') != _NATIVE_PROBE_SCHEMA:
        return None
    identity = payload.get('identity')
    if not isinstance(identity, dict) or identity.get('executable') != identity_executable:
        _log.debug('fresh native access probe identity did not match the executor')
        return None
    capabilities = payload.get('capabilities')
    if not isinstance(capabilities, list):
        return None
    parsed = {}
    for row in capabilities:
        if not isinstance(row, dict) or row.get('id') not in _MAC or row.get('id') in parsed:
            return None
        if row.get('status') not in {'granted', 'not_granted', 'unknown', 'unavailable'}:
            return None
        parsed[row['id']] = {
            'status': row['status'],
            'detail': str(row.get('detail') or 'Fresh native check returned no detail.'),
        }
    if set(parsed) != set(_MAC):
        return None
    return {'identity': identity, 'capabilities': parsed}


def _mac_status(capability: str) -> dict:
    spec = capability_spec(capability)
    if spec.request_mode != 'native':
        return _declaration_row(spec, 'Darwin')
    probe = _native_probe()
    if probe is None:
        return _mac_row(
            capability, status='unknown',
            detail='The fresh native permission check failed; authorization is unknown.',
        )
    current = probe['capabilities'].get(capability)
    if current is None:
        return _mac_row(capability, status='unknown', detail='Native authorization is unknown.')
    from openprogram.system_access_identity import observe
    return observe(_mac_row(capability, **current))


def report() -> dict:
    """Return fresh advisory status for this process, not the connecting client."""
    system = platform.system()
    execution_identity = _native_identity()
    if system == 'Darwin':
        probe = _native_probe()
        if probe is not None and isinstance(probe.get('identity'), dict):
            execution_identity = dict(probe['identity'])
        rows = []
        for spec in capability_registry():
            current = probe['capabilities'].get(spec.id) if (
                probe is not None and spec.id in _MAC) else None
            if current is not None:
                row = _capability_row(spec, **current)
            elif spec.id in _MAC:
                row = _capability_row(
                    spec, status='unknown',
                    detail='The fresh native permission check failed; authorization is unknown.',
                )
            else:
                row = _declaration_row(spec, system)
            if spec.id in _MAC:
                from openprogram.system_access_identity import observe
                row = observe(row)
            rows.append(row)
    elif system == 'Linux':
        wayland = bool(os.environ.get('WAYLAND_DISPLAY'))
        display = bool(os.environ.get('DISPLAY'))
        desktop_row = {
            'id': 'desktop_session', 'label': 'Desktop access', 'optional': True,
            'status': 'unsupported' if wayland else ('unknown' if display else 'unavailable'),
            'detail': ('The current desktop input backend does not provide Wayland portal authorization.' if wayland
                       else 'An X11 display is configured; access must be verified by the desktop backend.' if display
                       else 'No graphical desktop is configured for this process.'),
            'instruction': ('Use a supported X11 desktop session or a browser/VM backend. Do not disable desktop security.' if wayland
                            else 'Run the desktop worker in the intended signed-in graphical session; browser and ordinary CLI tasks do not require desktop access.'),
            'can_request': False,
        }
        rows = [desktop_row] + [_declaration_row(spec, system) for spec in capability_registry()]
    elif system == 'Windows':
        # Session names and administrator membership do not prove desktop access.
        desktop_row = {
            'id': 'desktop_session', 'label': 'Desktop access', 'optional': True,
            'status': 'unknown', 'detail': 'Desktop access is verified when the target is opened.',
            'instruction': 'Run in the intended signed-in desktop session. Locked screens, UAC secure desktop and higher-privilege applications may be inaccessible. Do not run the whole application as administrator.',
            'can_request': False,
        }
        rows = [desktop_row] + [_declaration_row(spec, system) for spec in capability_registry()]
    else:
        desktop_row = {'id': 'desktop_session', 'label': 'Desktop access', 'optional': True,
                 'status': 'unsupported', 'detail': 'No desktop permission backend for this platform.',
                 'instruction': 'Use a supported browser or remote VM backend.', 'can_request': False}
        rows = [desktop_row] + [_declaration_row(spec, system) for spec in capability_registry()]
    application = ''
    if system == 'Darwin':
        try:
            bundle = importlib.import_module('Foundation').NSBundle.mainBundle()
            application = str(bundle.objectForInfoDictionaryKey_('CFBundleName') or '')
        except Exception:
            _log.debug("bundle name lookup unavailable", exc_info=True)
    return {
        'schema': SYSTEM_ACCESS_SCHEMA,
        'version': SYSTEM_ACCESS_VERSION,
        'platform': system,
        'application': application,
        'host': socket.gethostname(),
        'executable': sys.executable,
        'pid': os.getpid(),
        'identity': execution_identity,
        'checked_at': time.time(),
        'capabilities': rows,
    }


def access_manifest_for_tool(tool_name: str, args: dict | None) -> dict | None:
    """Return a pre-effect durable wait manifest for local desktop GUI use.

    Browser and VM GUI paths have their own access boundary.  Only the
    macOS desktop executor has explicit OS capabilities that can be waited on
    before the GUI agent plans or dispatches an effect.
    """
    if str(tool_name) != 'gui_agent' or not isinstance(args, dict):
        return None
    surface = str(args.get('surface') or '').strip().lower()
    if surface not in {'', 'desktop'} or args.get('vm_url'):
        return None
    # The bridge treats a backend without an explicit desktop surface as the
    # browser execution path.
    if not surface and args.get('backend'):
        return None
    snapshot = report()
    if snapshot.get('platform') != 'Darwin':
        return None
    required_ids = {
        spec.id for spec in capability_registry()
        if 'gui_agent:desktop' in spec.operations
    }
    capabilities = [dict(row) for row in snapshot.get('capabilities', ())
                    if isinstance(row, dict) and row.get('id') in required_ids]
    missing = [row for row in capabilities if row.get('status') != 'granted']
    if not missing:
        return None
    required = [str(row['id']) for row in missing]
    return {
        'kind': 'system_access',
        'required_capabilities': required,
        'capabilities': capabilities,
        'prompt': 'Desktop access is required before this GUI task can run.',
        'options': [], 'multi': False, 'allow_custom': False,
        'detail': 'Authorize the required capabilities on the execution computer, then return to OpenProgram.',
        'schema': {}, 'questions': [], 'timeout': None,
        'request_metadata': {
            'tool': 'gui_agent', 'args': dict(args),
            'required_capabilities': required,
            'capabilities': capabilities,
            'source': 'system_access',
        },
        'policy_snapshot': {
            'version': 1, 'kind': 'system_access', 'on_grant': 'continue',
        },
    }


def _open_settings(capability: str) -> bool:
    """Open only the fixed native page after an explicit user setup action."""
    spec = capability_spec(capability)
    if not spec.settings_pane:
        return False
    try:
        appkit = importlib.import_module('AppKit')
        foundation = importlib.import_module('Foundation')
        url = foundation.NSURL.URLWithString_('x-apple.systempreferences:com.apple.preference.security?' + spec.settings_pane)
        return bool(appkit.NSWorkspace.sharedWorkspace().openURL_(url))
    except Exception:
        return False


def request_access(capability: str, *, open_settings: bool = False) -> dict:
    """Explicit local-user setup only; never call from a probe or a model tool."""
    spec = capability_spec(capability)
    if platform.system() != 'Darwin':
        raise ValueError('No native permission request for this capability on this platform.')
    if spec.request_mode != 'native':
        result = _declaration_row(spec, 'Darwin')
        if open_settings and spec.settings_pane:
            result['settings_opened'] = _open_settings(capability)
        return result
    if not _REQUEST_LOCK.acquire(blocking=False):
        raise RuntimeError('A system permission request is already in progress.')
    try:
        before = _mac_status(capability)
        if before['status'] == 'granted':
            return before
        if open_settings:
            result = _mac_status(capability)
            result['settings_opened'] = _open_settings(capability)
            return result
        if not before['can_request']:
            return before
        from openprogram.system_access_identity import prepare_request
        prepare_request(before)
        requested = _native_probe(request_capability=capability, timeout=_NATIVE_REQUEST_TIMEOUT)
        if requested is None:
            return _mac_row(capability, status='unknown', detail='Native authorization request did not complete; authorization was not confirmed.')
        after = _mac_status(capability)
        return after
    finally:
        _REQUEST_LOCK.release()


def doctor_rows() -> list[dict]:
    """Optional capability advice never blocks installation or upgrades."""
    snapshot = report()
    return [{'id': 'system_access:' + row['id'], 'ok': True,
             'label': row['label'], 'status': row['status'], 'optional': True,
             'detail': f"{row['status']}: {row['detail']}" +
                       ('' if row['status'] == 'granted' else ' ' + row['instruction'])}
            for row in snapshot['capabilities']]
