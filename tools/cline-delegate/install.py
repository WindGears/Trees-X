"""Install this local MCP bridge without changing API keys or other MCP entries."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import tomllib

FILES = ('cline_mcp.py', 'tasks.py', 'transport.py', 'workspace.py')


def replace_bytes(path: Path, data: bytes) -> None:
    descriptor, name = tempfile.mkstemp(prefix='.cline-install-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def configure(text: str, root: Path) -> str:
    parsed = tomllib.loads(text)
    entry = parsed.get('mcp_servers', {}).get('cline_delegate')
    if not isinstance(entry, dict):
        raise ValueError('Existing mcp_servers.cline_delegate entry is required; other entries will not be generated.')
    args = entry.get('args', [])
    if not args or Path(args[0]).name != 'cline_mcp.py':
        raise ValueError('The selected MCP entry does not point to the expected local bridge.')
    environment = dict(entry.get('env') or {})
    environment['CLINE_WORKSPACE_ROOT'] = str(root)
    environment['CLINE_REASONING_EFFORT'] = 'max'
    literal = 'env = { ' + ', '.join(json.dumps(str(k)) + ' = ' + json.dumps(str(v), ensure_ascii=False) for k, v in environment.items()) + ' }\n'
    match = re.search(r'^\[mcp_servers\.cline_delegate\][ \t]*\r?$', text, re.M)
    if not match:
        raise ValueError('MCP section layout is unsupported; no configuration was changed.')
    end_match = re.search(r'^\[', text[match.end():], re.M)
    end = match.end() + end_match.start() if end_match else len(text)
    block = text[match.end():end]
    if '[mcp_servers.cline_delegate.env]' in text:
        raise ValueError('Nested env table needs explicit merge; installer refuses to rewrite it.')
    if 'env' in entry:
        replaced, count = re.subn(r'^env[ \t]*=[ \t]*\{[^\r\n]*\}[ \t]*\r?$', lambda found: literal.rstrip() + ('\r' if found.group().endswith('\r') else ''), block, flags=re.M)
        if count != 1:
            raise ValueError('Existing env layout is unsupported; no configuration was changed.')
        block = replaced
    else:
        block = '\n' + literal + block.lstrip('\r\n')
    updated = text[:match.end()] + block + text[end:]
    result = tomllib.loads(updated)
    expected = dict(parsed)
    expected['mcp_servers'] = dict(parsed['mcp_servers'])
    expected['mcp_servers']['cline_delegate'] = {**entry, 'env': environment}
    if result != expected:
        raise ValueError('Configuration verification failed; no configuration was changed.')
    return updated


def install(workspace: Path, codex_home: Path) -> dict[str, object]:
    root = workspace.absolute()
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Workspace must be an existing regular directory.')
    config_path = codex_home / 'config.toml'
    original_config = config_path.read_bytes()
    original_text = original_config.decode('utf-8')
    entry = tomllib.loads(original_text)['mcp_servers']['cline_delegate']
    destination = Path(entry['args'][0]).absolute().parent
    intended = (codex_home / 'mcp/cline_delegate').absolute()
    if destination != intended or destination.is_symlink() or not destination.is_dir():
        raise ValueError('Installation target must be the existing Codex local Cline bridge directory.')
    updated_config = configure(original_text, root).encode('utf-8')
    source = Path(__file__).absolute().parent
    modules = {name: (source / name).read_bytes() for name in FILES}
    for name, data in modules.items():
        compile(data, name, 'exec')
    backup = destination / 'backups' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    original_modules = {}
    for name in FILES:
        target = destination / name
        original_modules[name] = target.read_bytes() if target.exists() else None
        if target.exists():
            shutil.copy2(target, backup / name)
    (backup / 'config.toml').write_bytes(original_config)
    installed = []
    try:
        for name, data in modules.items():
            replace_bytes(destination / name, data)
            installed.append(name)
        replace_bytes(config_path, updated_config)
    except OSError:
        for name in reversed(installed):
            original = original_modules[name]
            if original is None:
                (destination / name).unlink(missing_ok=True)
            else:
                replace_bytes(destination / name, original)
        replace_bytes(config_path, original_config)
        raise
    return {'installed_version': '2.0.0', 'directory': str(destination), 'backup': str(backup),
            'workspace_root': str(root), 'configured_env_reasoning_effort': 'max', 'reload_required': True,
            'module_sha256': {name: hashlib.sha256(data).hexdigest() for name, data in modules.items()},
            'note': 'Existing API key and model settings preserved; stored reasoning_effort may override env. Check cline_status after reload. A fresh MCP process is required for new tools.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=Path(__file__).absolute().parents[2])
    parser.add_argument('--codex-home', type=Path, default=Path.home() / '.codex')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.workspace, args.codex_home), ensure_ascii=False, indent=2))
    except Exception as error:
        # Configuration contents and credentials are never part of diagnostics.
        print(f'Installation refused or rolled back: {type(error).__name__}', file=__import__('sys').stderr)
        raise SystemExit(1)
