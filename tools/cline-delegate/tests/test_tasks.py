"""Offline regression tests for bounded, supervised delegated tasks."""
from __future__ import annotations

import copy
import itertools
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tasks import ACTIVE, TaskManager

CALL_IDS = itertools.count(1)


def tool_call(name: str, **arguments: object) -> dict:
    return {'id': f'call-{next(CALL_IDS)}', 'type': 'function', 'function': {
        'name': name, 'arguments': json.dumps(arguments)}}


def response(*calls: dict, answer: str = 'Ready for review.', complete: bool = True) -> dict:
    return {'complete': complete, 'answer': answer, 'tool_calls': list(calls),
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2},
            'finish_reason': 'tool_calls' if calls else 'stop', 'model': 'test/model'}


class FakeClient:
    api_key = 'test-key'

    def __init__(self, *responses: object, gate: threading.Event | None = None):
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.entered = threading.Event()
        self.gate = gate
        self.cancelled = threading.Event()

    def chat(self, **kwargs: object) -> dict:
        self.requests.append({key: copy.deepcopy(value) for key, value in kwargs.items()
                              if key not in ('cancel', 'deadline')})
        self.entered.set()
        if self.gate is not None and not self.gate.wait(5):
            raise TimeoutError('Test gate timed out.')
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)

    def cancel_active(self, event: threading.Event) -> None:
        self.cancelled.set()


class TaskTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name) / 'project'
        self.root.mkdir()
        (self.root / 'input.txt').write_text('captured input\n', encoding='utf-8')
        self.state = Path(self.directory.name) / 'state'
        self.managers: list[TaskManager] = []
        self.clients: list[FakeClient] = []

    def tearDown(self) -> None:
        for manager in self.managers:
            manager.close()
        for client in self.clients:
            if client.gate is not None:
                client.gate.set()
        deadline = time.monotonic() + 3
        while any(manager.clients for manager in self.managers) and time.monotonic() < deadline:
            time.sleep(.01)
        self.directory.cleanup()

    def manager(self, client: FakeClient) -> TaskManager:
        self.clients.append(client)
        manager = TaskManager(self.root, self.state, lambda: client)
        self.managers.append(manager)
        return manager

    def start(self, manager: TaskManager, **kwargs: object) -> str:
        values = {'prompt': 'Propose the requested edit.', 'model': 'test/model',
                  'read_files': ['input.txt'], 'write_files': ['output.txt']}
        values.update(kwargs)
        return manager.start(**values)['task_id']

    def finished(self, manager: TaskManager, task_id: str) -> dict:
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            record = manager.get(task_id)
            if record['state'] not in ACTIVE:
                return record
            time.sleep(.01)
        self.fail('Fake task did not reach a terminal state.')

    def blocked_apply(self, manager: TaskManager, task_id: str) -> None:
        result = manager.result(task_id)
        with self.assertRaises(ValueError):
            manager.apply(task_id, result['review_digest'])
        self.assertFalse((self.root / 'output.txt').exists())

    def test_tool_loop_stages_complete_file_until_explicit_reviewed_apply(self) -> None:
        client = FakeClient(response(tool_call('read_file', path='input.txt'),
                                    tool_call('search_files', query='captured'),
                                    tool_call('write_file', path='output.txt', content='full proposal\n')),
                            response(answer='All tests passed. test-key'))
        manager = self.manager(client)
        task_id = self.start(manager)
        record = self.finished(manager, task_id)
        self.assertEqual(record['state'], 'needs_review')
        self.assertEqual(record['api_calls'], 2)
        self.assertEqual(record['max_rounds'], 6)
        self.assertEqual(record['requested_reasoning_effort'], 'max')
        self.assertIsNone(record['effective_reasoning_effort'])
        self.assertIsNone(client.requests[0]['max_output_tokens'])
        self.assertEqual({item['function']['name'] for item in client.requests[0]['tools']},
                         {'list_files', 'read_file', 'search_files', 'write_file'})
        self.assertEqual(record['validation'], 'not_run')
        self.assertNotIn('test-key', record['summary'])
        self.assertTrue(all(item['ok'] for item in record['audit']))
        self.assertFalse((self.root / 'output.txt').exists())
        self.assertEqual(manager.result(task_id, 'output.txt')['content'], 'full proposal\n')
        result = manager.result(task_id)
        self.assertEqual(result['validation'], 'not_run')
        self.assertIn('full proposal', result['proposal']['files'][0]['diff'])
        applied = manager.apply(task_id, result['review_digest'])
        self.assertEqual(applied['status'], 'applied')
        self.assertEqual((self.root / 'output.txt').read_text(encoding='utf-8'), 'full proposal\n')
        self.assertEqual(manager.apply(task_id, result['review_digest'])['status'], 'already_applied')
        self.assertEqual(manager.get(task_id)['validation'], 'not_run')

    def test_prohibited_paths_and_unknown_shell_are_tool_errors_without_execution(self) -> None:
        client = FakeClient(response(tool_call('read_file', path='../outside.txt'),
                                    tool_call('read_file', path='.env.local'),
                                    tool_call('write_file', path='outside.txt', content='bad'),
                                    tool_call('execute_command', command='touch sentinel.txt')),
                            response())
        manager = self.manager(client)
        task_id = self.start(manager)
        record = self.finished(manager, task_id)
        self.assertEqual(record['state'], 'needs_review')
        self.assertEqual(record['api_calls'], 2)
        self.assertEqual([item['ok'] for item in record['audit']], [False] * 4)
        outputs = [item for item in client.requests[1]['messages'] if item['role'] == 'tool']
        self.assertTrue(all('error' in json.loads(item['content']) for item in outputs))
        self.assertFalse((self.root / 'outside.txt').exists())
        self.assertFalse((self.root / 'sentinel.txt').exists())

    def test_invalid_scope_is_rejected_before_any_paid_call(self) -> None:
        client = FakeClient(response())
        manager = self.manager(client)
        with self.assertRaises(ValueError):
            self.start(manager, read_files=['.env.local'])
        with self.assertRaises(ValueError):
            self.start(manager, write_files=['../outside.txt'])
        self.assertEqual(client.requests, [])
        self.assertEqual(manager.list(), [])

    def test_cancel_discards_late_response_and_cannot_revive_or_apply(self) -> None:
        gate = threading.Event()
        client = FakeClient(response(tool_call('write_file', path='output.txt', content='late')), gate=gate)
        manager = self.manager(client)
        task_id = self.start(manager)
        self.assertTrue(client.entered.wait(2))
        manager.cancel(task_id)
        self.assertTrue(client.cancelled.is_set())
        gate.set()
        self.assertEqual(self.finished(manager, task_id)['state'], 'cancelled')
        self.assertEqual(manager.get(task_id)['audit'], [])
        self.blocked_apply(manager, task_id)

    def test_cancel_ready_invalidates_review_receipt(self) -> None:
        manager = self.manager(FakeClient(response(tool_call('write_file', path='output.txt', content='x')), response()))
        task_id = self.start(manager)
        self.finished(manager, task_id)
        digest = manager.result(task_id)['review_digest']
        self.assertEqual(manager.cancel(task_id)['state'], 'cancelled')
        self.assertEqual(manager.stages[task_id].status, 'cancelled')
        with self.assertRaises(ValueError):
            manager.apply(task_id, digest)

    def test_round_budget_failure_keeps_staged_files_unapplied(self) -> None:
        manager = self.manager(FakeClient(response(tool_call('write_file', path='output.txt', content='x'))))
        task_id = self.start(manager, max_rounds=1)
        record = self.finished(manager, task_id)
        self.assertEqual(record['state'], 'failed')
        self.assertEqual(record['api_calls'], 1)
        self.assertIn('round', record['error'].lower())
        self.blocked_apply(manager, task_id)

    def test_transport_and_incomplete_results_cannot_be_applied(self) -> None:
        for outcome in (RuntimeError('Upstream failed test-key'), response(complete=False)):
            with self.subTest(outcome=type(outcome).__name__):
                manager = self.manager(FakeClient(outcome))
                task_id = self.start(manager)
                record = self.finished(manager, task_id)
                self.assertEqual(record['state'], 'failed')
                self.assertNotIn('test-key', record['error'])
                self.blocked_apply(manager, task_id)

    def test_captured_read_hash_conflict_blocks_apply(self) -> None:
        manager = self.manager(FakeClient(response(tool_call('write_file', path='output.txt', content='x')), response()))
        task_id = self.start(manager)
        self.finished(manager, task_id)
        (self.root / 'input.txt').write_text('changed after snapshot', encoding='utf-8')
        self.blocked_apply(manager, task_id)
        self.assertEqual(manager.get(task_id)['state'], 'needs_review')

    def test_tampered_digest_or_proposal_cannot_use_old_receipt(self) -> None:
        manager = self.manager(FakeClient(response(tool_call('write_file', path='output.txt', content='x')), response()))
        task_id = self.start(manager)
        self.finished(manager, task_id)
        result = manager.result(task_id)
        with self.assertRaises(ValueError):
            manager.apply(task_id, '0' * 64)
        manager.stages[task_id].write('output.txt', 'tampered proposal')
        self.assertNotEqual(result['review_digest'], manager.result(task_id)['review_digest'])
        self.blocked_apply(manager, task_id)

    def test_restart_marks_queued_and_running_interrupted_without_replay(self) -> None:
        client = FakeClient(response())
        manager = self.manager(client)
        with patch('tasks.threading.Thread.start'):
            task_ids = [self.start(manager), self.start(manager)]
        manager.records[task_ids[1]]['state'] = 'running'
        manager._save(manager.records[task_ids[1]])
        restored = self.manager(client)
        for task_id in task_ids:
            self.assertEqual(restored.get(task_id)['state'], 'interrupted')
            self.assertEqual(restored.get(task_id)['api_calls'], 0)
            self.blocked_apply(restored, task_id)
        self.assertEqual(client.requests, [])

    def test_active_status_and_list_do_not_wait_for_model_network(self) -> None:
        gate = threading.Event()
        client = FakeClient(response(), gate=gate)
        manager = self.manager(client)
        task_id = self.start(manager)
        self.assertTrue(client.entered.wait(2))
        started = time.monotonic()
        self.assertEqual(manager.get(task_id)['state'], 'running')
        self.assertEqual(manager.list()[0]['task_id'], task_id)
        self.assertLess(time.monotonic() - started, .5)
        with self.assertRaises(ValueError):
            manager.result(task_id)
        gate.set()
        self.finished(manager, task_id)

    def test_invalid_argument_types_do_not_start_api_calls(self) -> None:
        client = FakeClient(response())
        manager = self.manager(client)
        for values in ({'max_rounds': True}, {'max_wall_seconds': False},
                       {'max_output_tokens': True}, {'read_files': 'input.txt'},
                       {'write_files': True}, {'read_files': [False]}, {'acceptance': False}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.start(manager, **values)
        self.assertEqual(client.requests, [])

    def test_untrusted_usage_keeps_only_finite_nonnegative_numbers(self) -> None:
        outcome = response()
        outcome['usage'] = {'prompt_tokens': 4, 'negative': -1, 'boolean': True,
                            'infinity': float('inf'), 'nan': float('nan'),
                            'details': {'valid': 2, 'text': 'untrusted'}}
        manager = self.manager(FakeClient(outcome))
        task_id = self.start(manager)
        record = self.finished(manager, task_id)
        self.assertEqual(record['state'], 'needs_review')
        self.assertEqual(record['usage'], [{'prompt_tokens': 4, 'details': {'valid': 2}}])
        saved = json.loads((self.state / task_id / 'task.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['state'], 'needs_review')

    def test_restart_ignores_nonobject_local_task_record_without_replay(self) -> None:
        broken = self.state / ('0' * 32)
        broken.mkdir(parents=True)
        (broken / 'task.json').write_text('[]', encoding='utf-8')
        client = FakeClient(response())
        manager = self.manager(client)
        self.assertEqual(manager.list(), [])
        self.assertEqual(client.requests, [])

    def test_interrupted_replacement_requires_explicit_recovery_without_api_replay(self) -> None:
        import workspace
        client = FakeClient(response(tool_call('write_file', path='output.txt', content='x')), response())
        manager = self.manager(client)
        task_id = self.start(manager)
        self.finished(manager, task_id)
        digest = manager.result(task_id)['review_digest']
        replace = workspace.os.replace

        def interrupted_replace(source: object, destination: object) -> None:
            replace(source, destination)
            if Path(destination) == self.root / 'output.txt':
                raise KeyboardInterrupt('Simulated process interruption after replacement.')

        with patch('workspace.os.replace', side_effect=interrupted_replace), self.assertRaises(KeyboardInterrupt):
            manager.apply(task_id, digest)
        self.assertTrue((self.root / 'output.txt').exists())
        restored = self.manager(client)
        self.assertEqual(restored.get(task_id)['state'], 'recovery_required')
        with self.assertRaises(ValueError):
            restored.apply(task_id, digest)
        with self.assertRaises(ValueError):
            restored.recover(task_id, '0' * 64)
        self.assertTrue((self.root / 'output.txt').exists())
        recovery_digest = restored.result(task_id)['review_digest']
        self.assertEqual(restored.recover(task_id, recovery_digest)['status'], 'rolled_back')
        self.assertFalse((self.root / 'output.txt').exists())
        self.assertEqual(restored.get(task_id)['state'], 'interrupted')
        self.assertIsNone(restored.get(task_id)['receipt'])
        with self.assertRaises(ValueError):
            restored.apply(task_id, recovery_digest)
        self.assertEqual(restored.get(task_id)['validation'], 'not_run')
        self.assertEqual(len(client.requests), 2)


    def test_restart_reconciles_durable_apply_before_task_record_commit(self) -> None:
        client = FakeClient(response(tool_call('write_file', path='output.txt', content='committed')), response())
        manager = self.manager(client)
        task_id = self.start(manager)
        self.finished(manager, task_id)
        digest = manager.result(task_id)['review_digest']
        original_save = manager._save
        def fail_final_save(record):
            if record['state'] == 'applied':
                raise KeyboardInterrupt('Simulate stop after durable workspace commit.')
            original_save(record)
        with patch.object(manager, '_save', side_effect=fail_final_save), self.assertRaises(KeyboardInterrupt):
            manager.apply(task_id, digest)
        restored = self.manager(client)
        self.assertEqual(restored.get(task_id)['state'], 'applied')
        self.assertEqual((self.root / 'output.txt').read_text(), 'committed')
        with self.assertRaises(ValueError):
            restored.cancel(task_id)
        self.assertEqual(restored.apply(task_id, digest)['status'], 'already_applied')
        self.assertEqual(len(client.requests), 2)

    def test_unsafe_live_target_keeps_task_visible_without_journal_rewrite(self) -> None:
        client = FakeClient(response(tool_call('write_file', path='output.txt', content='proposal')), response())
        manager = self.manager(client)
        task_id = self.start(manager)
        self.finished(manager, task_id)
        record_path = self.state / task_id / 'task.json'
        before = record_path.read_bytes()
        (self.root / 'output.txt').mkdir()
        restored = self.manager(client)
        self.assertEqual(restored.get(task_id)['state'], 'blocked')
        self.assertIsNone(restored.result(task_id)['review_digest'])
        with self.assertRaises(ValueError):
            restored.apply(task_id, '0' * 64)
        with self.assertRaises(ValueError):
            restored.cancel(task_id)
        self.assertEqual(record_path.read_bytes(), before)
        (self.root / 'output.txt').rmdir()
        restored_again = self.manager(client)
        self.assertEqual(restored_again.get(task_id)['state'], 'needs_review')
        self.assertEqual(len(client.requests), 2)

if __name__ == '__main__':
    unittest.main()
