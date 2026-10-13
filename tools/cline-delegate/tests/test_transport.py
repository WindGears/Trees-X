"""Tests for transport.py. No real network access is ever performed."""

import io
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
for _candidate in (os.path.dirname(_HERE), _HERE):
    if _candidate and _candidate not in sys.path:
        sys.path.insert(0, _candidate)

import transport  # noqa: E402


SECRET = 'sk-test-secret'


class FakeResponse:
    def __init__(self, body, status=200):
        self._body = bytes(body)
        self.status = status
        self.closed = False

    def read(self, size=-1):
        if self.closed:
            raise ValueError('read of a closed response')
        if not self._body:
            return b''
        if size is None or size < 0:
            chunk = self._body
            self._body = b''
            return chunk
        chunk = self._body[:size]
        self._body = self._body[size:]
        return chunk

    def close(self):
        self.closed = True


class BlockingResponse:
    def __init__(self, gate):
        self.gate = gate
        self.closed = False

    def read(self, size=-1):
        self.gate.wait(5)
        if self.closed:
            raise ValueError('read of a closed response')
        return b''

    def close(self):
        self.closed = True
        self.gate.set()


class FakeOpener:
    def __init__(self, body=b'', status=200, error=None):
        self.body = body
        self.status = status
        self.error = error
        self.calls = 0
        self.last_request = None
        self.last_timeout = None
        self.response = None

    def open(self, request, timeout=None):
        self.calls += 1
        self.last_request = request
        self.last_timeout = timeout
        if self.error is not None:
            raise self.error
        self.response = FakeResponse(self.body, self.status)
        return self.response


def http_error(code):
    return urllib.error.HTTPError(
        'http://127.0.0.1:9/chat/completions',
        code,
        'boom',
        {},
        io.BytesIO((SECRET + ' leaked body').encode('utf-8')),
    )


def make_client(body=b'', status=200, error=None, api_key=SECRET):
    client = transport.Client('http://127.0.0.1:9', api_key=api_key)
    opener = FakeOpener(body=body, status=status, error=error)
    client._opener = opener
    return client, opener


def sse(events, done=True):
    lines = []
    for event in events:
        payload = event if isinstance(event, str) else json.dumps(event)
        lines.append('data: ' + payload)
        lines.append('')
    if done:
        lines.append('data: [DONE]')
        lines.append('')
    return '\n'.join(lines).encode('utf-8')


def sent_payload(opener):
    return json.loads(opener.last_request.data.decode('utf-8'))


class ChatStreamTests(unittest.TestCase):
    def test_stream_success_with_usage_only_delta(self):
        body = sse([
            {'model': 'gpt-x', 'choices': [{'delta': {'role': 'assistant', 'content': ''}, 'finish_reason': None}]},
            {'choices': [{'delta': {'content': 'Hello'}, 'finish_reason': None}]},
            {'choices': [{'delta': {'content': [{'type': 'text', 'text': ' world'}]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
            {'usage': {'prompt_tokens': 3, 'completion_tokens': 2, 'total_tokens': 5}, 'choices': []},
        ])
        client, opener = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'hi'}], model='gpt-x')

        self.assertTrue(result['complete'])
        self.assertEqual(result['answer'], 'Hello world')
        self.assertEqual(result['model'], 'gpt-x')
        self.assertEqual(result['finish_reason'], 'stop')
        self.assertEqual(result['tool_calls'], [])
        self.assertEqual(
            result['usage'],
            {'prompt_tokens': 3, 'completion_tokens': 2, 'total_tokens': 5},
        )
        self.assertEqual(result['requested_reasoning_effort'], 'max')
        self.assertIsNone(result['effective_reasoning_effort'])

        payload = sent_payload(opener)
        self.assertTrue(payload['stream'])
        self.assertEqual(payload['reasoning_effort'], 'max')
        self.assertNotIn('max_tokens', payload)
        self.assertEqual(
            opener.last_request.get_header('Authorization'), 'Bearer ' + SECRET
        )
        self.assertEqual(opener.calls, 1)

    def test_full_json_body_is_accepted(self):
        body = json.dumps({
            'model': 'm1',
            'choices': [
                {'message': {'role': 'assistant', 'content': 'hi'}, 'finish_reason': 'stop'}
            ],
            'usage': {'total_tokens': 1, 'prompt_tokens': 1},
        }).encode('utf-8')
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m1')
        self.assertEqual(result['answer'], 'hi')
        self.assertEqual(result['usage'], {'total_tokens': 1, 'prompt_tokens': 1})

    def test_fragmented_tool_calls_are_merged(self):
        args = json.dumps({'city': 'SF'})
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'id': 'call_1', 'type': 'function',
                 'function': {'name': 'get_', 'arguments': args[:5]}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'function': {'name': 'weather', 'arguments': args[5:]}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(len(result['tool_calls']), 1)
        self.assertEqual(
            result['tool_calls'][0],
            {
                'id': 'call_1',
                'type': 'function',
                'function': {'name': 'get_weather', 'arguments': args},
            },
        )

    def test_tool_calls_split_by_index(self):
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'index': 1, 'id': 'b', 'function': {'name': 'second', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'id': 'a', 'function': {'name': 'first', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(
            [c['function']['name'] for c in result['tool_calls']],
            ['first', 'second'],
        )
        self.assertEqual([c['id'] for c in result['tool_calls']], ['a', 'b'])

    def test_multiline_data_comment_and_trailing_line(self):
        first = json.dumps({'choices': [{'delta': {'content': 'hi'}, 'finish_reason': None}]})
        cut = len(first) // 2
        second = json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})
        lines = [
            ': ping',
            '',
            'data: ' + first[:cut],
            'data: ' + first[cut:],
            '',
            'data: ' + second,
            '',
            'data: [DONE]',
        ]
        client, _ = make_client(body='\n'.join(lines).encode('utf-8'))
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['answer'], 'hi')

    def test_stream_without_done_marker_fails(self):
        body = sse([
            {'choices': [{'delta': {'content': 'hi'}, 'finish_reason': 'stop'}]},
        ], done=False)
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_length_finish_reason_fails(self):
        body = sse([
            {'choices': [{'delta': {'content': 'hi'}, 'finish_reason': 'length'}]},
        ])
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_content_filter_finish_reason_fails(self):
        body = sse([
            {'choices': [{'delta': {'content': 'hi'}, 'finish_reason': 'content_filter'}]},
        ])
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_empty_answer_without_tools_fails(self):
        body = sse([
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
            {'usage': {'total_tokens': 1}, 'choices': []},
        ])
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_truncated_tool_arguments_fail(self):
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'id': 'call_1', 'function': {'name': 'f', 'arguments': '{"a": '}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_malformed_json_is_not_ignored(self):
        body = b'data: {not json}\n\ndata: [DONE]\n\n'
        client, _ = make_client(body=body)
        with self.assertRaises(transport.ProtocolError):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_response_too_large(self):
        body = b'data: ' + b'x' * 400 + b'\n\n'
        with mock.patch.object(transport, 'MAX_RESPONSE_BYTES', 32):
            client, _ = make_client(body=body)
            with self.assertRaises(transport.ResponseTooLarge):
                client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_reasoning_content_is_not_returned(self):
        body = sse([
            {'choices': [{'delta': {'reasoning_content': 'secret chain', 'content': 'ok'},
                         'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['answer'], 'ok')
        self.assertNotIn('secret chain', json.dumps(result))
        self.assertNotIn('reasoning_content', json.dumps(result))

    def test_non_numeric_usage_is_dropped(self):
        body = sse([
            {'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]},
            {'choices': [], 'usage': {'total_tokens': 4, 'details': {'note': 'chain of thought'}}},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['usage'], {'total_tokens': 4})


class RequestShapeTests(unittest.TestCase):
    def test_reasoning_effort_omitted_when_none(self):
        client, opener = make_client(body=sse([
            {'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]},
        ]))
        result = client.chat(
            messages=[{'role': 'user', 'content': 'x'}],
            model='m',
            reasoning_effort=None,
        )
        payload = sent_payload(opener)
        self.assertNotIn('reasoning_effort', payload)
        self.assertNotIn('max_tokens', payload)
        self.assertIsNone(result['requested_reasoning_effort'])

    def test_explicit_max_output_tokens_is_forwarded(self):
        client, opener = make_client(body=sse([
            {'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]},
        ]))
        client.chat(
            messages=[{'role': 'user', 'content': 'x'}],
            model='m',
            reasoning_effort='low',
            max_output_tokens=128,
        )
        payload = sent_payload(opener)
        self.assertEqual(payload['reasoning_effort'], 'low')
        self.assertEqual(payload['max_tokens'], 128)

    def test_tools_are_forwarded_as_function_tools_only(self):
        client, opener = make_client(body=sse([
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'id': 'c', 'function': {'name': 'f', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ]))
        client.chat(
            messages=[{'role': 'user', 'content': 'x'}],
            model='m',
            tools=[{'type': 'function', 'function': {'name': 'f', 'description': 'd'}}],
        )
        payload = sent_payload(opener)
        self.assertEqual(
            payload['tools'],
            [{'type': 'function', 'function': {'name': 'f', 'description': 'd'}}],
        )

    def test_non_function_tools_rejected(self):
        client, opener = make_client()
        with self.assertRaises(transport.TransportError):
            client.chat(
                messages=[{'role': 'user', 'content': 'x'}],
                model='m',
                tools=[{'type': 'retrieval'}],
            )
        self.assertEqual(opener.calls, 0)

    def test_invalid_reasoning_effort_rejected(self):
        client, opener = make_client()
        with self.assertRaises(transport.TransportError):
            client.chat(
                messages=[{'role': 'user', 'content': 'x'}],
                model='m',
                reasoning_effort='medium',
            )
        self.assertEqual(opener.calls, 0)

    def test_missing_api_key_fails_without_request(self):
        client, opener = make_client(api_key=None)
        with self.assertRaises(transport.TransportError):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(opener.calls, 0)


class ErrorTests(unittest.TestCase):
    def test_http_429_is_not_retried_and_body_is_hidden(self):
        client, opener = make_client(error=http_error(429))
        with self.assertRaises(transport.HTTPStatusError) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn('429', str(ctx.exception))
        self.assertNotIn(SECRET, str(ctx.exception))
        self.assertNotIn('leaked body', str(ctx.exception))
        self.assertEqual(opener.calls, 1)

    def test_network_error_message_hides_secrets(self):
        error = urllib.error.URLError('boom ' + SECRET)
        client, opener = make_client(error=error)
        with self.assertRaises(transport.TransportError) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertNotIn(SECRET, str(ctx.exception))
        self.assertEqual(opener.calls, 1)

    def test_redact_handles_explicit_secrets_and_bearer(self):
        self.assertEqual(
            transport.redact('Bearer ' + SECRET), 'Bearer [REDACTED]'
        )
        self.assertEqual(
            transport.redact('key=' + SECRET, secrets=(SECRET,)),
            'key=[REDACTED]',
        )
        self.assertEqual(transport.redact('nothing to do'), 'nothing to do')

    def test_deadline_in_the_past_fails_before_request(self):
        client, opener = make_client()
        with self.assertRaises(transport.RequestTimeout):
            client.chat(
                messages=[{'role': 'user', 'content': 'x'}],
                model='m',
                deadline=time.monotonic() - 1,
            )
        self.assertEqual(opener.calls, 0)

    def test_socket_timeout_is_reported(self):
        client, opener = make_client(error=urllib.error.URLError(TimeoutError('slow')))
        with self.assertRaises(transport.RequestTimeout):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(opener.calls, 1)


class CancelTests(unittest.TestCase):
    def test_cancel_before_request_issues_nothing(self):
        client, opener = make_client()
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(transport.Cancelled):
            client.chat(
                messages=[{'role': 'user', 'content': 'x'}], model='m', cancel=cancel
            )
        self.assertEqual(opener.calls, 0)

    def test_cancel_active_closes_the_response(self):
        gate = threading.Event()
        response = BlockingResponse(gate)
        client, opener = make_client()
        opener.open = lambda request, timeout=None: response

        cancel = threading.Event()
        box = {}

        def run():
            try:
                client.chat(
                    messages=[{'role': 'user', 'content': 'x'}],
                    model='m',
                    cancel=cancel,
                )
            except BaseException as exc:  # noqa: BLE001 - recorded for assertions
                box['exc'] = exc

        worker = threading.Thread(target=run)
        worker.start()

        limit = time.time() + 5
        while time.time() < limit:
            with transport._ACTIVE_LOCK:
                if cancel in transport._ACTIVE:
                    break
            time.sleep(0.01)
        else:
            self.fail('response was never registered as active')

        cancel.set()
        self.assertTrue(transport.cancel_active(cancel))
        self.assertFalse(transport.cancel_active(cancel))
        worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertIsInstance(box.get('exc'), transport.Cancelled)
        self.assertTrue(response.closed)


class UrlTests(unittest.TestCase):
    def test_https_rejects_userinfo_query_and_fragment(self):
        for url in (
            'https://user:pass@api.example.com/v1',
            'https://api.example.com/v1?key=1',
            'https://api.example.com/v1#frag',
            'ftp://api.example.com/v1',
        ):
            with self.assertRaises(transport.TransportError):
                transport.Client(url, api_key='k')

    def test_http_only_for_loopback_hosts(self):
        with self.assertRaises(transport.TransportError):
            transport.Client('http://api.example.com/v1', api_key='k')
        transport.Client('http://127.0.0.1:1234/v1', api_key='k')
        transport.Client('http://localhost:1234/v1', api_key='k')
        transport.Client('http://[::1]:1234/v1', api_key='k')
        transport.Client('https://api.example.com/v1', api_key='k')

    def test_redirects_are_disabled(self):
        client = transport.Client('https://api.example.com/v1', api_key='k')
        handlers = [
            handler
            for handler in client._opener.handlers
            if isinstance(handler, urllib.request.HTTPRedirectHandler)
        ]
        self.assertTrue(handlers)
        for handler in handlers:
            self.assertIsInstance(handler, transport._NoRedirectHandler)
            with self.assertRaises(transport.TransportError):
                handler.redirect_request(
                    None, None, 302, 'Found', {}, 'https://evil.example/'
                )

    def test_get_json_uses_get_and_parses_body(self):
        client, opener = make_client(body=json.dumps({'data': [{'id': 'm1'}]}).encode('utf-8'))
        result = client.get_json('/models')
        self.assertEqual(result, {'data': [{'id': 'm1'}]})
        self.assertEqual(opener.last_request.get_method(), 'GET')

    def test_get_json_rejects_malformed_body(self):
        client, _ = make_client(body=b'not json')
        with self.assertRaises(transport.ProtocolError):
            client.get_json('/models')


class ToolCallShapeTests(unittest.TestCase):
    def test_full_json_tool_calls_without_index_are_enumerated(self):
        body = json.dumps({
            'model': 'm',
            'choices': [{
                'message': {
                    'role': 'assistant',
                    'content': '',
                    'tool_calls': [
                        {'id': 'a', 'type': 'function',
                         'function': {'name': 'first', 'arguments': '{}'}},
                        {'id': 'b', 'type': 'function',
                         'function': {'name': 'second', 'arguments': '{"n": 1}'}},
                    ],
                },
                'finish_reason': 'tool_calls',
            }],
        }).encode('utf-8')
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(
            [c['function']['name'] for c in result['tool_calls']],
            ['first', 'second'],
        )
        self.assertEqual([c['id'] for c in result['tool_calls']], ['a', 'b'])
        self.assertEqual(
            [c['type'] for c in result['tool_calls']], ['function', 'function']
        )
        self.assertEqual(
            result['tool_calls'][1]['function']['arguments'], '{"n": 1}'
        )

    def test_streamed_single_fragment_without_index_is_kept(self):
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'id': 'c1', 'function': {'name': 'f', 'arguments': '{"a": 1}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(len(result['tool_calls']), 1)
        self.assertEqual(
            result['tool_calls'][0],
            {
                'id': 'c1',
                'type': 'function',
                'function': {'name': 'f', 'arguments': '{"a": 1}'},
            },
        )

    def test_streamed_fragments_without_index_do_not_merge(self):
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'id': 'c1', 'function': {'name': 'first', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {'tool_calls': [
                {'id': 'c2', 'function': {'name': 'second', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(
            [c['function']['name'] for c in result['tool_calls']],
            ['first', 'second'],
        )
        self.assertEqual([c['id'] for c in result['tool_calls']], ['c1', 'c2'])

    def test_bad_tool_call_index_is_rejected(self):
        for bad in (-1, 3.5, '0', True):
            body = sse([
                {'choices': [{'delta': {'tool_calls': [
                    {'index': bad, 'id': 'c',
                     'function': {'name': 'f', 'arguments': '{}'}}
                ]}, 'finish_reason': None}]},
                {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
            ])
            client, _ = make_client(body=body)
            with self.assertRaises(transport.ProtocolError):
                client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_missing_tool_call_id_is_not_fabricated(self):
        body = sse([
            {'choices': [{'delta': {'tool_calls': [
                {'index': 0, 'function': {'name': 'f', 'arguments': '{}'}}
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
        ])
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertNotIn('call_0', str(ctx.exception))

    def test_invalid_tool_call_name_and_id_are_rejected(self):
        cases = (
            {'index': 0, 'id': 'c',
             'function': {'name': 'bad name!', 'arguments': '{}'}},
            {'index': 0, 'id': 'bad id!',
             'function': {'name': 'f', 'arguments': '{}'}},
            {'index': 0, 'id': 'c',
             'function': {'name': 'x' * 65, 'arguments': '{}'}},
            {'index': 0, 'id': 'c' * 129,
             'function': {'name': 'f', 'arguments': '{}'}},
        )
        for item in cases:
            body = sse([
                {'choices': [{'delta': {'tool_calls': [item]},
                              'finish_reason': None}]},
                {'choices': [{'delta': {}, 'finish_reason': 'tool_calls'}]},
            ])
            client, _ = make_client(body=body)
            with self.assertRaises(transport.ProtocolError):
                client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_truncated_tool_arguments_in_full_json_body_fail(self):
        body = json.dumps({
            'model': 'm',
            'choices': [{
                'message': {
                    'role': 'assistant',
                    'tool_calls': [{
                        'id': 'c',
                        'type': 'function',
                        'function': {'name': 'f', 'arguments': '{"a": '},
                    }],
                },
                'finish_reason': 'tool_calls',
            }],
        }).encode('utf-8')
        client, _ = make_client(body=body)
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')


class ContentBlockTests(unittest.TestCase):
    def test_reasoning_content_blocks_are_not_used_as_answer(self):
        body = sse([
            {'choices': [{'delta': {'content': [
                {'type': 'reasoning', 'text': 'secret chain'},
                {'type': 'output_text', 'text': 'ok'},
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['answer'], 'ok')
        self.assertNotIn('secret chain', json.dumps(result))

    def test_untyped_content_blocks_are_ignored(self):
        body = sse([
            {'choices': [{'delta': {'content': [
                {'text': 'untyped'},
                {'type': 'refusal', 'text': 'no'},
                {'type': 'text', 'text': 'ok'},
            ]}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
        ])
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['answer'], 'ok')


class ServerErrorTests(unittest.TestCase):
    def test_error_object_in_stream_fails(self):
        body = sse([
            {'error': {'type': 'invalid_request_error', 'message': 'boom'}},
        ], done=False)
        client, _ = make_client(body=body)
        with self.assertRaises(transport.ProtocolError) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertIn('payload omitted', str(ctx.exception))
        self.assertNotIn('invalid_request_error', str(ctx.exception))

    def test_error_object_in_full_json_body_fails(self):
        body = json.dumps(
            {'error': {'message': 'nope', 'code': 'bad'}}
        ).encode('utf-8')
        client, _ = make_client(body=body)
        with self.assertRaises(transport.ProtocolError):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_http_error_status_is_never_treated_as_complete(self):
        body = sse([
            {'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]},
        ])
        client, opener = make_client(body=body, status=503)
        with self.assertRaises(transport.HTTPStatusError) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(opener.calls, 1)

    def test_http_error_body_is_not_surfaced(self):
        body = ('data: {"error": {"message": "' + SECRET + '"}}\n\n')
        client, _ = make_client(body=body.encode('utf-8'), status=500)
        with self.assertRaises(transport.HTTPStatusError) as ctx:
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertNotIn(SECRET, str(ctx.exception))


class RequestValidationTests(unittest.TestCase):
    def _client(self):
        return make_client(body=sse([
            {'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]},
        ]))

    def test_max_output_tokens_rejects_bool_zero_negative_and_float(self):
        for bad in (True, False, 0, -1, 128.0, '128'):
            client, opener = self._client()
            with self.assertRaises(transport.TransportError):
                client.chat(
                    messages=[{'role': 'user', 'content': 'x'}],
                    model='m',
                    max_output_tokens=bad,
                )
            self.assertEqual(opener.calls, 0)

    def test_non_finite_request_numbers_are_rejected(self):
        for bad in (float('nan'), float('inf'), float('-inf')):
            client, opener = self._client()
            with self.assertRaises(transport.TransportError):
                client.chat(
                    messages=[{'role': 'user', 'content': bad}],
                    model='m',
                )
            self.assertEqual(opener.calls, 0)

    def test_non_finite_response_numbers_are_rejected(self):
        body = (
            'data: {"choices": [{"delta": {"content": "ok"},'
            ' "finish_reason": "stop"}], "usage": {"total_tokens": NaN}}'
            '\n\n'
            'data: [DONE]\n\n'
        ).encode('utf-8')
        client, _ = make_client(body=body)
        with self.assertRaises(transport.ProtocolError):
            client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')

    def test_non_finite_usage_numbers_are_dropped(self):
        body = (
            'data: {"choices": [{"delta": {"content": "ok"},'
            ' "finish_reason": "stop"}]}\n\n'
            'data: {"choices": [], "usage": {"total_tokens": 4,'
            ' "prompt_tokens": 1e999}}\n\n'
            'data: [DONE]\n\n'
        ).encode('utf-8')
        client, _ = make_client(body=body)
        result = client.chat(messages=[{'role': 'user', 'content': 'x'}], model='m')
        self.assertEqual(result['usage'], {'total_tokens': 4})


class PublicJsonTests(unittest.TestCase):
    def test_get_json_without_api_key_sends_no_authorization(self):
        client, opener = make_client(
            body=json.dumps({'data': []}).encode('utf-8'), api_key=None
        )
        self.assertEqual(client.get_json('/models'), {'data': []})
        self.assertIsNone(opener.last_request.get_header('Authorization'))
        self.assertEqual(opener.last_request.get_method(), 'GET')

    def test_get_json_with_api_key_sends_bearer(self):
        client, opener = make_client(body=b'{"data": []}')
        client.get_json('/models')
        self.assertEqual(
            opener.last_request.get_header('Authorization'), 'Bearer ' + SECRET
        )

    def test_get_json_rejects_unsafe_paths(self):
        for path in (
            'models',
            '',
            '//evil.example/models',
            '/a//b',
            '/models?key=1',
            '/models#frag',
            'https://evil.example/models',
            'ftp://evil.example/models',
            '/models x',
        ):
            client, opener = make_client(body=b'{}')
            with self.assertRaises(transport.TransportError):
                client.get_json(path)
            self.assertEqual(opener.calls, 0)

    def test_get_json_response_size_is_capped(self):
        with mock.patch.object(transport, 'MAX_JSON_BYTES', 32):
            client, _ = make_client(body=b'{"data": "' + b'x' * 64 + b'"}')
            with self.assertRaises(transport.ResponseTooLarge):
                client.get_json('/models')


class CancelHelperTests(unittest.TestCase):
    def test_client_cancel_active_delegates_to_module_function(self):
        client, _ = make_client()
        event = threading.Event()
        self.assertFalse(client.cancel_active(event))

        class Closable:
            def __init__(self):
                self.closed = False

            def close(self):
                self.closed = True

        response = Closable()
        with transport._ACTIVE_LOCK:
            transport._ACTIVE[event] = response
        try:
            self.assertTrue(client.cancel_active(event))
            self.assertTrue(response.closed)
            self.assertFalse(client.cancel_active(event))
        finally:
            with transport._ACTIVE_LOCK:
                transport._ACTIVE.pop(event, None)


if __name__ == '__main__':
    unittest.main()
