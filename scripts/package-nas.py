"""Package only encrypted production configuration and the existing deploy command."""
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

root = Path(__file__).resolve().parents[1]
files = ['compose.yaml', '.env.prod', 'scripts/deploy.sh', 'docs/operations.md', '운영안내.html']
environment = (root / '.env.prod').read_text(encoding='utf-8')
assert 'DOTENV_PUBLIC_KEY_PROD=' in environment and 'DOTENV_PRIVATE_KEY' not in environment
for line in environment.splitlines():
    if re.match(r'^[A-Z_][A-Z0-9_]*=', line) and not line.startswith('DOTENV_PUBLIC_KEY'):
        value = line.split('=', 1)[1].strip().strip('"\'')
        assert not value or value.startswith('encrypted:'), 'Unencrypted production setting'
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
manifest = json.loads((root / f'output/releases/{sha[:12]}/release.json').read_text(encoding='utf-8-sig'))
assert manifest['commit'] == sha and manifest['tag'] == sha[:12] and len(manifest['images']) == 3
content = {name: (root / name).read_text(encoding='utf-8').replace('\r\n', '\n').encode() for name in files}
content['SOURCE_COMMIT'] = (sha + '\n').encode()
content['IMAGE_DIGESTS'] = ''.join(i['image'] + ' ' + i['digest'] + '\n' for i in manifest['images']).encode()
out = root / 'output/releases/ggeujeok-nas-config.tar.gz'
with tarfile.open(out, 'w:gz', format=tarfile.USTAR_FORMAT) as archive:
    for name, data in content.items():
        entry = tarfile.TarInfo(name)
        entry.mode = 0o755 if name.endswith('.sh') else 0o644
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
print('Packaged encrypted configuration, source identity and three image digests; no private keys')
