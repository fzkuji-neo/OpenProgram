"""Release source staging applies only the pinned, verified migration."""
from pathlib import Path
import hashlib
import json
import runpy
import subprocess

import pytest


@pytest.mark.parametrize("tampered", [False, True])
def test_program_stage_keeps_source_pin_and_checks_migration(tmp_path, tampered):
    source = tmp_path / "source"
    source.mkdir()
    repository = tmp_path / "build"
    release = repository / "scripts/release"
    release.mkdir(parents=True)

    def git(root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()

    for root in (source, repository):
        git(root, "init", "-q")
        git(root, "config", "core.hooksPath", "/dev/null")
    original = source / "entry.py"
    original.write_text("VALUE = 'original'\n")
    git(source, "add", ".")
    git(source, "-c", "user.name=Stage Test", "-c", "user.email=stage@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "-qm", "pinned source")
    pin = git(source, "rev-parse", "HEAD")
    original.write_text("VALUE = 'migrated'\n")
    patch = release / "migration.patch"
    patch.write_text(git(source, "diff") + "\n")
    original.write_text("VALUE = 'original'\n")
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    (release / "product-runtime.json").write_text(json.dumps({"programs": {"gui": {
        "commit": pin, "import": "test_program", "repository": str(source),
        "sourcePatch": patch.name, "sourcePatchSha256": digest,
    }}}))
    script = release / "stage-program-source.py"
    script.write_bytes((Path(__file__).resolve().parents[4] / "scripts/release/stage-program-source.py").read_bytes())
    stage = runpy.run_path(str(script))["stage"]
    if tampered:
        patch.write_text(patch.read_text().replace("migrated", "unverified"))
        with pytest.raises(ValueError, match="checksum mismatch"):
            stage("gui", tmp_path / "staged", checkout=source)
    else:
        stage("gui", tmp_path / "staged", checkout=source)
        assert git(tmp_path / "staged", "rev-parse", "HEAD") == pin
        assert (tmp_path / "staged/entry.py").read_text() == "VALUE = 'migrated'\n"
    assert original.read_text() == "VALUE = 'original'\n"
    assert git(source, "status", "--porcelain") == ""
