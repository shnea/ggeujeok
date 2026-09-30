"""CI checks that need no production or development decryption keys."""
import re
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').split('\0')
assert not any(p.startswith(('.secrets/', '.tools/', '.deploy/')) or p == '.env.keys' for p in tracked)
for name in filter(None, tracked):
    try:
        content = (root / name).read_text(encoding='utf-8')
    except (UnicodeError, OSError):
        continue
    assert not re.search(r'/volume[0-9]+/', content), f'NAS private path in {name}'
for name in ('.env.dev', '.env.prod'):
    text = (root / name).read_text(encoding='utf-8')
    assert 'DOTENV_PRIVATE_KEY' not in text, name
    for line in text.splitlines():
        if re.match(r'^[A-Z_][A-Z0-9_]*=', line) and not line.startswith('DOTENV_PUBLIC_KEY'):
            value = line.split('=', 1)[1].strip().strip('"\'')
            assert not value or value.startswith('encrypted:'), f'Plaintext setting in {name}'
print('PASS encrypted runtime configuration, private-file exclusion and NAS path exclusion')
