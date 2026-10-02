"""Host-side redaction for browser observations, including upstream ARIA trees."""
from __future__ import annotations

import json

PASSWORD_VALUES_SCRIPT = """() => Array.from(
    document.querySelectorAll('input[type=password]'), element => element.value
).filter(value => value.length > 0)"""


def password_values(page) -> tuple[str, ...]:
    values = []
    for frame in getattr(page, "frames", None) or [page]:
        captured = frame.evaluate(PASSWORD_VALUES_SCRIPT)
        if not isinstance(captured, list) or any(not isinstance(value, str) for value in captured):
            raise RuntimeError("Cannot safely redact browser password fields")
        values.extend(captured)
    return tuple(values)


def redact_password_values(value, secrets):
    """Remove secrets before emitting observations; never log the captured values."""
    if isinstance(value, str):
        variants = {variant for secret in secrets if secret for variant in (
            secret, json.dumps(secret, ensure_ascii=False)[1:-1],
            json.dumps(secret, ensure_ascii=True)[1:-1],
        )}
        for secret in sorted(variants, key=len, reverse=True):
            value = value.replace(secret, "[redacted]")
        return value
    if isinstance(value, dict):
        return {key: redact_password_values(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_password_values(item, secrets) for item in value]
    return value
