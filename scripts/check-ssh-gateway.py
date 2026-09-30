"""Test SSH archive validation and configuration handoff without SSH, Docker or real keys."""
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

source = Path(__file__).with_name('ssh-deploy-gateway.sh').read_text(encoding='utf-8')
sha = '012345abcdef' + '0' * 28
files = ['compose.yaml', '.env.prod', 'scripts/deploy.sh', 'docs/operations.md', '운영안내.html', 'SOURCE_COMMIT', 'IMAGE_DIGESTS']
deploy = '''#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$1" = check ]; then [ "${FAIL_AT:-}" != config ]; exit; fi
[ -n "$DEPLOY_PARENT_PID" ]
[ "$(cat "$root/.deploy/lock/pid")" = "$DEPLOY_PARENT_PID" ]
[ -f "$RELEASE_DIGESTS" ]
[ "${FAIL_AT:-}" != up ]
printf '%s\\n' "$1" > "$root/.deploy/current"
'''

for scenario in ('success', 'command', 'sha', 'extra', 'link', 'duplicate', 'config', 'up', 'busy'):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / '.deploy').mkdir()
        (root / 'bin').mkdir()
        (root / 'bin/id').write_text('#!/bin/sh\necho 0\n')
        (root / 'bin/id').chmod(0o755)
        (root / 'compose.yaml').write_text('original')
        (root / '.deploy/current').write_text('0.1.3\n')
        if scenario == 'busy':
            (root / '.deploy/lock').mkdir()
            (root / '.deploy/lock/pid').write_text('999999')
        gateway = root / 'gateway.sh'
        gateway.write_text(source)
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz', format=tarfile.USTAR_FORMAT) as archive:
            members = files + (['../escape'] if scenario == 'extra' else ['compose.yaml'] if scenario == 'duplicate' else [])
            for name in members:
                data = 'replacement'
                if name == 'scripts/deploy.sh': data = deploy
                elif name == 'SOURCE_COMMIT': data = ('f' * 40 if scenario == 'sha' else sha) + '\n'
                elif name == 'IMAGE_DIGESTS': data = 'image sha256:dummy\n' * 3
                raw = data.encode()
                entry = tarfile.TarInfo(name)
                entry.size = len(raw)
                if scenario == 'link' and name == 'compose.yaml':
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = '/tmp/forbidden'
                    entry.size = 0
                archive.addfile(entry, io.BytesIO(raw))
        env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'], FAIL_AT=scenario,
                   NAS_DEPLOY_PATH=directory, LC_ALL='C')
        command = 'sh -c bad' if scenario == 'command' else 'deploy ' + sha
        result = subprocess.run(['sh', str(gateway), command], input=buffer.getvalue(), env=env, capture_output=True)
        assert (result.returncode == 0) == (scenario == 'success'), (scenario, result.stderr.decode())
        if scenario in ('success', 'up'):
            assert (root / 'compose.yaml').read_text() == 'replacement'
            assert (root / '.deploy/configs/0.1.3/compose.yaml').read_text() == 'original'
        else:
            assert (root / 'compose.yaml').read_text() == 'original'
        assert (root / '.deploy/current').read_text().strip() == (sha[:12] if scenario == 'success' else '0.1.3')
        assert (root / '.deploy/lock').exists() == (scenario == 'busy')
print('PASS SSH command/commit/archive validation, preflight, previous configuration, shared lock and deployment handoff')
