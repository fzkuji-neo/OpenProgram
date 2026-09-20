from openprogram import system_access


def test_registry_is_unique_and_report_contains_all_declared_capabilities(monkeypatch):
    system_access.validate_capability_registry()
    monkeypatch.setattr(system_access.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        system_access,
        "_native_probe",
        lambda: {
            "identity": {"executable": "test"},
            "capabilities": {
                "screen_recording": {"status": "granted", "detail": "fresh"},
                "accessibility": {"status": "granted", "detail": "fresh"},
            },
        },
    )
    rows = {row["id"]: row for row in system_access.report()["capabilities"]}
    report = system_access.report()
    assert report["schema"] == system_access.SYSTEM_ACCESS_SCHEMA
    assert report["version"] == system_access.SYSTEM_ACCESS_VERSION
    assert report["identity"]["executable"]
    assert set(rows) == {spec.id for spec in system_access.capability_registry()}
    assert rows["apple_events"]["request_mode"] == "targeted"
    assert rows["apple_events"]["identity_scope"] == "target_app"
    assert rows["apple_events"]["identity"]["bundle_id"] == "ai.openprogram.desktop"
    assert rows["calendar"]["label_zh"] == "日历"
    assert rows["accessibility"]["identity"]["bundle_id"] == "ai.openprogram.runtime"
    assert rows["screen_recording"]["identity"]["bundle_id"] == "ai.openprogram.runtime"
    assert rows["file_read"]["subject"] == "user_selected_path"
    assert rows["file_read"]["settings_available"] is False
    assert rows["microphone"]["status"] == "unknown"


def test_declaration_request_never_runs_native_probe(monkeypatch):
    monkeypatch.setattr(system_access.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        system_access,
        "_native_probe",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("declaration-only capabilities must not probe")
        ),
    )
    row = system_access.request_access("calendar")
    assert row["id"] == "calendar"
    assert row["status"] == "unknown"
    assert row["can_request"] is False


def test_gui_manifest_selects_only_operation_capabilities(monkeypatch):
    monkeypatch.setattr(system_access.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        system_access,
        "report",
        lambda: {
            "platform": "Darwin",
            "capabilities": [
                {"id": "screen_recording", "status": "not_granted"},
                {"id": "accessibility", "status": "granted"},
                {"id": "apple_events", "status": "unknown"},
            ],
        },
    )
    manifest = system_access.access_manifest_for_tool("gui_agent", {"surface": "desktop"})
    assert manifest["required_capabilities"] == ["screen_recording"]
