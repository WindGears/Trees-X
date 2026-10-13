"""Offline MCP contracts; no test contacts Cline or uses personal settings."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cline_mcp as server


def request(method: str, params: object = None, request_id: int = 1) -> dict:
    result = {'jsonrpc': '2.0', 'id': request_id, 'method': method}
    if params is not None:
        result['params'] = params
    return result


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.settings_path = Path(self.directory.name) / 'settings.json'
        self.settings_patch = patch.object(server, 'SETTINGS_FILE', self.settings_path)
        self.settings_patch.start()
        self.key_patch = patch.object(server, 'api_key', return_value='test-key')
        self.key_patch.start()
        self.network_patch = patch.object(server, 'client', side_effect=AssertionError('Paid API forbidden in offline tests.'))
        self.network_patch.start()

    def tearDown(self) -> None:
        self.network_patch.stop()
        self.key_patch.stop()
        self.settings_patch.stop()
        self.directory.cleanup()

    def call(self, name: str, arguments: object) -> dict:
        return server.jsonrpc_response(request('tools/call', {'name': name, 'arguments': arguments}))

    def assert_tool_error(self, name: str, arguments: object) -> None:
        reply = self.call(name, arguments)
        self.assertEqual(reply['jsonrpc'], '2.0')
        self.assertTrue(reply['result']['isError'])
        self.assertNotIn('test-key', json.dumps(reply))

    def test_initialize_negotiates_known_protocol_and_falls_back(self) -> None:
        for offered in ('2024-11-05', '2025-03-26', '2025-06-18', 'unknown-version'):
            with self.subTest(offered=offered):
                reply = server.jsonrpc_response(request('initialize', {'protocolVersion': offered}))
                expected = offered if offered != 'unknown-version' else '2024-11-05'
                self.assertEqual(reply['result']['protocolVersion'], expected)
                self.assertEqual(reply['result']['capabilities'], {'tools': {}})
                self.assertEqual(reply['result']['serverInfo']['name'], server.SERVER_NAME)

    def test_notifications_are_ignored_without_dispatch(self) -> None:
        with patch.object(server, 'tool', side_effect=AssertionError('Notification dispatched.')):
            for message in ({'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                            {'jsonrpc': '2.0', 'method': 'tools/call', 'params': {
                                'name': 'cline_test_model', 'arguments': {}}}):
                self.assertIsNone(server.jsonrpc_response(message))

    def test_unknown_method_has_protocol_error_and_ping_is_empty(self) -> None:
        reply = server.jsonrpc_response(request('unknown-method', request_id=9))
        self.assertEqual(reply['id'], 9)
        self.assertEqual(reply['error']['code'], -32601)
        self.assertEqual(server.jsonrpc_response(request('ping'))['result'], {})

    def test_tool_catalog_has_exact_capabilities_and_closed_argument_schemas(self) -> None:
        listed = server.jsonrpc_response(request('tools/list'))['result']['tools']
        names = {item['name'] for item in listed}
        self.assertEqual(names, {'cline_status', 'cline_list_models', 'cline_select_model',
                                'cline_test_model', 'cline_delegate', 'cline_start_task',
                                'cline_task_status', 'cline_task_result', 'cline_cancel_task',
                                'cline_apply_task', 'cline_recover_task'})
        self.assertEqual(len(listed), len(names))
        for item in listed:
            schema = item['inputSchema']
            self.assertEqual(schema['type'], 'object')
            self.assertFalse(schema['additionalProperties'])
            self.assertTrue(set(schema['required']).issubset(schema['properties']))
        self.assertFalse(any(token in name for name in names for token in ('exec', 'shell', 'git')))

    def test_status_is_truthful_and_does_not_expose_secret(self) -> None:
        reply = self.call('cline_status', {})
        self.assertFalse(reply['result']['isError'])
        output = json.loads(reply['result']['content'][0]['text'])
        self.assertTrue(output['api_key_set'])
        self.assertNotIn('test-key', json.dumps(output))
        self.assertEqual(output['capabilities'], {'async_tasks': True, 'scoped_staging': True,
                         'supervisor_apply': True, 'model_shell': False,
                         'model_live_write': False, 'model_git': False})
        self.assertIsNone(output['effective_reasoning_effort'])
        self.assertEqual(output['reasoning_verification'], 'unknown_until_upstream_reports')
        self.assertFalse(output['automatic_api_retry'])

    def test_unknown_required_or_extra_arguments_never_dispatch(self) -> None:
        with patch.object(server, 'tool', side_effect=AssertionError('Invalid arguments dispatched.')) as dispatch:
            for name, arguments in (('not_a_tool', {}), ('cline_status', {'secret': 'test-key'}),
                                    ('cline_apply_task', {'task_id': 'x'}),
                                    ('cline_delegate', {}), ('cline_start_task', []),
                                    ('cline_status', None), ('cline_status', False)):
                with self.subTest(name=name, arguments=arguments):
                    self.assert_tool_error(name, arguments)
            dispatch.assert_not_called()

    def test_schema_types_enums_bounds_and_path_arrays_are_enforced(self) -> None:
        bad_calls = [('cline_task_status', {'task_id': False}),
                     ('cline_list_models', {'query': []}),
                     ('cline_start_task', {'prompt': 'x', 'read_files': 'input.txt'}),
                     ('cline_start_task', {'prompt': 'x', 'write_files': [True]}),
                     ('cline_start_task', {'prompt': 'x', 'max_rounds': True}),
                     ('cline_start_task', {'prompt': 'x', 'max_rounds': 13}),
                     ('cline_start_task', {'prompt': 'x', 'max_wall_seconds': 1}),
                     ('cline_delegate', {'prompt': 'x', 'max_output_tokens': 0}),
                     ('cline_delegate', {'prompt': 'x', 'role': 'shell'}),
                     ('cline_select_model', {'model_id': 1}),
                     ('cline_select_model', {'model_id': 'test/model', 'reasoning_effort': 'medium'})]
        with patch.object(server, 'tool', side_effect=AssertionError('Invalid value dispatched.')) as dispatch:
            for name, arguments in bad_calls:
                with self.subTest(name=name, arguments=arguments):
                    self.assert_tool_error(name, arguments)
            dispatch.assert_not_called()

    def test_save_model_is_local_and_distinguishes_requested_effort(self) -> None:
        reply = self.call('cline_select_model', {'model_id': 'test/model', 'reasoning_effort': 'max'})
        self.assertFalse(reply['result']['isError'])
        saved = json.loads(self.settings_path.read_text(encoding='utf-8'))
        self.assertEqual(saved, {'model': 'test/model', 'reasoning_effort': 'max'})
        output = json.loads(reply['result']['content'][0]['text'])
        self.assertEqual(output['requested_reasoning_effort'], 'max')
        self.assertIn('not asserted', output['note'])
        self.assertEqual(self.call('cline_status', {})['result']['isError'], False)

    def test_model_catalog_filters_invalid_ids_without_claiming_effective_effort(self) -> None:
        catalog = {'models': [{'id': 'test/model', 'name': 'Test', 'reasoningOptions': ['max']},
                              {'id': 'invalid-model-id', 'name': 'Invalid'}],
                   'recommended': ['other/model']}
        found = server.extract_models(catalog)
        self.assertEqual([item['id'] for item in found], ['other/model', 'test/model'])
        self.assertEqual(found[1]['reasoningOptions'], ['max'])
        self.assertNotIn('effective_reasoning_effort', found[1])

    def test_recovery_route_is_explicit_supervisor_action_without_api(self) -> None:
        with patch.object(server, 'manager') as factory:
            factory.return_value.recover.return_value = {'status': 'rolled_back'}
            reply = self.call('cline_recover_task', {'task_id': '1' * 32, 'review_digest': '2' * 64})
            self.assertFalse(reply['result']['isError'])
            factory.return_value.recover.assert_called_once_with('1' * 32, '2' * 64)
            self.assertEqual(json.loads(reply['result']['content'][0]['text'])['status'], 'rolled_back')
        self.assert_tool_error('cline_recover_task', {})
        self.assert_tool_error('cline_recover_task', {'task_id': '1' * 32})

    def test_stdio_parse_notifications_and_eof_exit_without_api_or_personal_settings(self) -> None:
        script = Path(server.__file__).resolve()
        env = os.environ.copy()
        for key in list(env):
            if key.startswith('CLINE_'):
                env.pop(key)
        env.update({'CLINE_SETTINGS_FILE': str(self.settings_path),
                    'CLINE_STATE_ROOT': str(Path(self.directory.name) / 'state'),
                    'CLINE_WORKSPACE_ROOT': self.directory.name,
                    'CLINE_API_BASE_URL': 'http://127.0.0.1:1'})
        messages = [request('initialize'), request('tools/list'),
                    {'jsonrpc': '2.0', 'method': 'tools/call', 'params': {
                        'name': 'cline_test_model', 'arguments': {}}},
                    request('tools/call', {'name': 'cline_status', 'arguments': {}}), request('ping')]
        incoming = '{ invalid private-marker\n[]\n' + ''.join(json.dumps(item) + '\n' for item in messages)
        started = time.monotonic()
        child = subprocess.run([sys.executable, str(script)], input=incoming, encoding='utf-8',
                               capture_output=True, env=env, cwd=self.directory.name, timeout=8)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertLess(time.monotonic() - started, 5)
        replies = [json.loads(line) for line in child.stdout.splitlines()]
        self.assertEqual(len(replies), 4)
        self.assertTrue(all(item['jsonrpc'] == '2.0' for item in replies))
        status = json.loads(replies[2]['result']['content'][0]['text'])
        self.assertFalse(status['api_key_set'])
        self.assertNotIn('private-marker', child.stderr + child.stdout)
        self.assertIn('contents omitted', child.stderr)
        self.assertFalse(self.settings_path.exists())
        self.assertFalse((Path(self.directory.name) / 'state').exists())


    def test_stdio_uses_utf8_even_when_windows_locale_requests_gbk(self) -> None:
        env = dict(os.environ, PYTHONIOENCODING='gbk',
                   CLINE_SETTINGS_FILE=str(self.settings_path), CLINE_WORKSPACE_ROOT='示例✓', CLINE_API_KEY='')
        payload = request('tools/call', {'name': 'cline_status', 'arguments': {}})
        child = subprocess.run([sys.executable, server.__file__], input=json.dumps(payload).encode('utf-8') + b'\n',
                               capture_output=True, env=env, timeout=8)
        self.assertEqual(child.returncode, 0)
        reply = json.loads(child.stdout.decode('utf-8'))
        result = json.loads(reply['result']['content'][0]['text'])
        self.assertEqual(result['workspace_root'], '示例✓')

if __name__ == '__main__':
    unittest.main()
