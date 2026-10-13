"""Installer regressions using disposable homes and synthetic credentials only."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install as installer


class InstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.temporary = Path(self.directory.name)
        self.workspace = self.temporary / 'project with spaces'
        self.workspace.mkdir()
        self.codex_home = self.temporary / 'fake-codex'
        self.destination = self.codex_home / 'mcp' / 'cline_delegate'
        self.destination.mkdir(parents=True)
        self.source = self.temporary / 'synthetic-source'
        self.source.mkdir()
        self.new_modules = {
            name: f"VERSION = 'fixture-v2-{name}'\n".encode('utf-8')
            for name in installer.FILES
        }
        self.old_modules = {
            name: f"VERSION = 'fixture-v1-{name}'\n".encode('utf-8')
            for name in installer.FILES
        }
        for name in installer.FILES:
            (self.source / name).write_bytes(self.new_modules[name])
            (self.destination / name).write_bytes(self.old_modules[name])
        self.source_patch = patch.object(installer, '__file__', str(self.source / 'install.py'))
        self.source_patch.start()
        self.addCleanup(self.source_patch.stop)
        self.config_path = self.codex_home / 'config.toml'
        self.auth_path = self.codex_home / 'auth.json'
        self.auth_bytes = b'{"fixture_only": "synthetic-auth-marker"}\n'
        self.auth_path.write_bytes(self.auth_bytes)
        self.settings_path = self.codex_home / 'cline_delegate_settings.json'
        self.settings_bytes = b'{"model":"fixture/model","reasoning_effort":"high"}\n'
        self.settings_path.write_bytes(self.settings_bytes)
        self.unrelated_prefix = (
            '# Keep comments, Unicode and multiline values byte-for-byte.\n'
            'model = "fixture/model"\n'
            'model_reasoning_effort = "high"\n'
            'preferred_auth_method = "apikey"\n'
            'instructions = """First line\n第二行\n"""\n\n'
            '[features]\n'
            'multi_agent = true\n\n'
            '[profiles."local profile"]\n'
            'model = "another/model"\n'
            'approval_policy = "never"\n\n'
        )
        self.unrelated_suffix = (
            '\n[mcp_servers.other_bridge]\n'
            'command = "fixture-command" # Existing integration\n'
            'args = ["--existing", "Unicode-保留"]\n'
            'env = { KEEP_ME = "unchanged" }\n\n'
            '[projects."I:/synthetic project"]\n'
            'trust_level = "trusted"\n\n'
            '[[agents.entries]]\n'
            'name = "fixture-agent"\n'
            'weights = [1, 2, 3]\n'
        )
        self.write_config()

    def write_config(self, *, include_env: bool = True, arguments: list[str] | None = None) -> None:
        selected_arguments = arguments if arguments is not None else [str(self.destination / 'cline_mcp.py')]
        block = (
            '[mcp_servers.cline_delegate]\n'
            'command = "fixture-python"\n'
            f'args = {json.dumps(selected_arguments, ensure_ascii=False)}\n'
            'enabled = true\n'
            'startup_timeout_sec = 30.0\n'
            '# Preserve the selected entry metadata as well.\n'
        )
        if include_env:
            block += (
                'env = { CLINE_API_KEY = "synthetic-key-marker", '
                'CLINE_API_BASE_URL = "https://fixture.invalid/api/v1", '
                'CLINE_SOCKET_TIMEOUT_SEC = "75", CLINE_DEFAULT_MODEL = "fixture/model", '
                'CLINE_WORKSPACE_ROOT = "I:/old-fixture", CLINE_REASONING_EFFORT = "high", '
                'CUSTOM_ENV = "保留" }\n'
            )
        self.original_config = (self.unrelated_prefix + block + self.unrelated_suffix).encode('utf-8')
        self.config_path.write_bytes(self.original_config)

    def assert_preserved_side_files(self) -> None:
        self.assertEqual(self.auth_path.read_bytes(), self.auth_bytes)
        self.assertEqual(self.settings_path.read_bytes(), self.settings_bytes)

    def assert_original_installation(self, absent: tuple[str, ...] = ()) -> None:
        self.assertEqual(self.config_path.read_bytes(), self.original_config)
        for name, data in self.old_modules.items():
            if name in absent:
                self.assertFalse((self.destination / name).exists())
            else:
                self.assertEqual((self.destination / name).read_bytes(), data)
        self.assert_preserved_side_files()
        self.assertFalse(list(self.codex_home.rglob('.cline-install-*')))

    def test_updates_only_selected_environment_preserves_complete_unrelated_toml_and_auth(self) -> None:
        before = tomllib.loads(self.original_config.decode('utf-8'))
        expected = copy.deepcopy(before)
        expected['mcp_servers']['cline_delegate']['env'].update({
            'CLINE_WORKSPACE_ROOT': str(self.workspace.absolute()),
            'CLINE_REASONING_EFFORT': 'max',
        })
        result = installer.install(self.workspace, self.codex_home)
        updated = self.config_path.read_text(encoding='utf-8')
        self.assertEqual(tomllib.loads(updated), expected)
        self.assertTrue(updated.startswith(self.unrelated_prefix))
        self.assertTrue(updated.endswith(self.unrelated_suffix))
        self.assertIn('# Preserve the selected entry metadata as well.', updated)
        self.assertEqual(result['workspace_root'], str(self.workspace.absolute()))
        self.assertEqual(result['configured_env_reasoning_effort'], 'max')
        self.assertIn('stored reasoning_effort may override env', result['note'])
        self.assertTrue(result['reload_required'])
        self.assert_preserved_side_files()
        # Reporting metadata must not contain even the synthetic key or auth contents.
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn('synthetic-key-marker', serialized)
        self.assertNotIn('synthetic-auth-marker', serialized)

    def test_creates_local_complete_backup_and_reports_verified_module_hashes(self) -> None:
        (self.destination / 'local-extra.txt').write_bytes(b'keep local file\n')
        result = installer.install(self.workspace, self.codex_home)
        backup = Path(result['backup'])
        self.assertEqual(backup.parent, self.destination / 'backups')
        self.assertEqual((backup / 'config.toml').read_bytes(), self.original_config)
        self.assertEqual({path.name for path in backup.iterdir()}, {'config.toml', *installer.FILES})
        for name in installer.FILES:
            self.assertEqual((backup / name).read_bytes(), self.old_modules[name])
            installed = (self.destination / name).read_bytes()
            self.assertEqual(installed, self.new_modules[name])
            self.assertEqual(result['module_sha256'][name], hashlib.sha256(installed).hexdigest())
        self.assertEqual((self.destination / 'local-extra.txt').read_bytes(), b'keep local file\n')
        self.assert_preserved_side_files()

    def test_existing_selected_entry_without_environment_gains_only_two_fields(self) -> None:
        self.write_config(include_env=False)
        expected = tomllib.loads(self.original_config.decode('utf-8'))
        expected['mcp_servers']['cline_delegate']['env'] = {
            'CLINE_WORKSPACE_ROOT': str(self.workspace.absolute()),
            'CLINE_REASONING_EFFORT': 'max',
        }
        installer.install(self.workspace, self.codex_home)
        self.assertEqual(tomllib.loads(self.config_path.read_text(encoding='utf-8')), expected)
        self.assert_preserved_side_files()

    def test_accepts_crlf_toml_preserves_unrelated_bytes_and_windows_paths(self) -> None:
        self.original_config = self.original_config.replace(b'\n', b'\r\n')
        self.config_path.write_bytes(self.original_config)
        expected = tomllib.loads(self.original_config.decode('utf-8'))
        expected['mcp_servers']['cline_delegate']['env'].update({
            'CLINE_WORKSPACE_ROOT': str(self.workspace.absolute()),
            'CLINE_REASONING_EFFORT': 'max',
        })
        installer.install(self.workspace, self.codex_home)
        updated = self.config_path.read_bytes()
        self.assertEqual(tomllib.loads(updated.decode('utf-8')), expected)
        self.assertTrue(updated.startswith(self.unrelated_prefix.replace('\n', '\r\n').encode('utf-8')))
        self.assertTrue(updated.endswith(self.unrelated_suffix.replace('\n', '\r\n').encode('utf-8')))
        self.assert_preserved_side_files()

    def test_refuses_absent_destination_without_creating_it_or_changing_config(self) -> None:
        for name in installer.FILES:
            (self.destination / name).unlink()
        self.destination.rmdir()
        with self.assertRaises(ValueError):
            installer.install(self.workspace, self.codex_home)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.config_path.read_bytes(), self.original_config)
        self.assert_preserved_side_files()

    def test_refuses_non_directory_destination_without_changing_it(self) -> None:
        for name in installer.FILES:
            (self.destination / name).unlink()
        self.destination.rmdir()
        self.destination.write_bytes(b'not a directory\n')
        with self.assertRaises(ValueError):
            installer.install(self.workspace, self.codex_home)
        self.assertEqual(self.destination.read_bytes(), b'not a directory\n')
        self.assertEqual(self.config_path.read_bytes(), self.original_config)
        self.assert_preserved_side_files()

    def test_refuses_destination_outside_the_existing_codex_bridge(self) -> None:
        other = self.temporary / 'unrelated-bridge'
        other.mkdir()
        sentinel = other / 'cline_mcp.py'
        sentinel.write_bytes(b'keep unrelated bridge\n')
        self.write_config(arguments=[str(sentinel)])
        with self.assertRaises(ValueError):
            installer.install(self.workspace, self.codex_home)
        self.assert_original_installation()
        self.assertEqual(sentinel.read_bytes(), b'keep unrelated bridge\n')
        self.assertFalse((self.destination / 'backups').exists())

    def test_refuses_missing_selected_entry_without_generating_configuration(self) -> None:
        original = (self.unrelated_prefix + self.unrelated_suffix).encode('utf-8')
        self.config_path.write_bytes(original)
        with self.assertRaises((ValueError, KeyError)):
            installer.install(self.workspace, self.codex_home)
        self.assertEqual(self.config_path.read_bytes(), original)
        for name, data in self.old_modules.items():
            self.assertEqual((self.destination / name).read_bytes(), data)
        self.assertFalse((self.destination / 'backups').exists())
        self.assert_preserved_side_files()

    def test_refuses_unexpected_selected_script_and_unsupported_nested_environment(self) -> None:
        self.write_config(arguments=[str(self.destination / 'unrelated.py')])
        with self.assertRaises(ValueError):
            installer.install(self.workspace, self.codex_home)
        self.assert_original_installation()
        self.write_config(include_env=False)
        self.original_config = self.original_config.replace(
            self.unrelated_suffix.encode('utf-8'),
            b'\n[mcp_servers.cline_delegate.env]\nCLINE_API_KEY = "synthetic-key-marker"\n'
            + self.unrelated_suffix.encode('utf-8'),
        )
        self.config_path.write_bytes(self.original_config)
        with self.assertRaises(ValueError):
            installer.install(self.workspace, self.codex_home)
        self.assert_original_installation()
        self.assertFalse((self.destination / 'backups').exists())

    def test_invalid_source_is_rejected_before_any_installation_write(self) -> None:
        (self.source / installer.FILES[-1]).write_bytes(b'def invalid source(:\n')
        with self.assertRaises(SyntaxError):
            installer.install(self.workspace, self.codex_home)
        self.assert_original_installation()
        self.assertFalse((self.destination / 'backups').exists())

    def test_module_replacement_failure_restores_original_modules_and_config(self) -> None:
        replace = installer.replace_bytes
        fail_target = self.destination / installer.FILES[2]
        failure_injected = False

        def fail_once(path: Path, data: bytes) -> None:
            nonlocal failure_injected
            if path == fail_target and not failure_injected:
                failure_injected = True
                raise OSError('synthetic module replacement failure')
            replace(path, data)

        with patch.object(installer, 'replace_bytes', side_effect=fail_once):
            with self.assertRaises(OSError):
                installer.install(self.workspace, self.codex_home)
        self.assertTrue(failure_injected)
        self.assert_original_installation()
        backups = list((self.destination / 'backups').iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'config.toml').read_bytes(), self.original_config)

    def test_config_failure_removes_new_modules_and_restores_original_configuration(self) -> None:
        absent = (installer.FILES[1], installer.FILES[-1])
        for name in absent:
            (self.destination / name).unlink()
        replace = installer.replace_bytes
        failure_injected = False

        def fail_after_config_write(path: Path, data: bytes) -> None:
            nonlocal failure_injected
            replace(path, data)
            if path == self.config_path and not failure_injected:
                failure_injected = True
                raise OSError('synthetic failure after config replacement')

        with patch.object(installer, 'replace_bytes', side_effect=fail_after_config_write):
            with self.assertRaises(OSError):
                installer.install(self.workspace, self.codex_home)
        self.assertTrue(failure_injected)
        self.assert_original_installation(absent=absent)
        backup = next((self.destination / 'backups').iterdir())
        self.assertEqual({path.name for path in backup.iterdir()}, {'config.toml', *(set(installer.FILES) - set(absent))})


if __name__ == '__main__':
    unittest.main()
