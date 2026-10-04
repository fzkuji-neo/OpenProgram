#!/usr/bin/env python3
"""Stage pinned Program source and apply a verified API migration patch."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def stage(name: str, destination: Path, checkout: Path | None = None):
    release = Path(__file__).resolve().parent
    repository = release.parent.parent
    config = json.loads((release / 'product-runtime.json').read_text())['programs'][name]
    revision = config['commit']
    if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('Program source requires a full commit ID.')
    if destination.exists():
        raise ValueError(f'Program staging destination already exists: {destination}')
    candidates = [checkout] if checkout is not None else []
    roots = [repository]
    listing = run('git', 'worktree', 'list', '--porcelain', cwd=repository)
    roots.extend(Path(line[9:]) for line in listing.splitlines() if line.startswith('worktree '))
    for root in dict.fromkeys(roots):
        for container in ('packages', 'applications'):
            candidates.append(root / 'openprogram/programs' / container / config['import'])
    source = config['repository']
    for candidate in candidates:
        if candidate is None or not (candidate / '.git').exists():
            continue
        try:
            run('git', 'cat-file', '-e', revision + '^{commit}', cwd=candidate)
        except subprocess.CalledProcessError:
            continue
        source = str(candidate.resolve())
        break
    destination.mkdir(parents=True)
    run('git', 'init', '-q', str(destination))
    run('git', 'fetch', '-q', '--depth', '1', source, revision, cwd=destination)
    run('git', 'checkout', '-q', '--detach', 'FETCH_HEAD', cwd=destination)
    if run('git', 'rev-parse', 'HEAD', cwd=destination) != revision:
        raise ValueError('Staged Program source does not match its pinned commit.')
    patch_name = config.get('sourcePatch')
    if patch_name:
        patch = (release / patch_name).resolve()
        if not patch.is_relative_to(release):
            raise ValueError('Program patch must be inside the release directory.')
        digest = hashlib.sha256(patch.read_bytes()).hexdigest()
        if digest != config.get('sourcePatchSha256'):
            raise ValueError(f'Program migration patch checksum mismatch: {name}')
        run('git', 'apply', '--check', str(patch), cwd=destination)
        run('git', 'apply', str(patch), cwd=destination)
    print(f'Staged {name} from {revision} with its verified source migration.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('name', choices=('gui', 'research', 'wiki'))
    parser.add_argument('destination', type=Path)
    parser.add_argument('--checkout', type=Path)
    args = parser.parse_args()
    stage(args.name, args.destination, args.checkout)
