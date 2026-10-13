"""Review-driven protocol boundaries; never use an external service."""
import math
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
import unittest
from unittest import mock

import transport
from test_transport import FakeResponse, SECRET, make_client, sse


class BoundaryTests(unittest.TestCase):
    def test_tool_argument_limit_counts_utf8_bytes(self):
        call = {'id': 'call_1', 'type': 'function', 'function': {
            'name': 'write_file', 'arguments': '{"content":"汉汉"}'}}
        client, _ = make_client(sse([{'choices': [{'delta': {'tool_calls': [call]}, 'finish_reason': 'tool_calls'}]}]))
        with mock.patch.object(transport, 'MAX_TOOL_ARGUMENT_BYTES', 18):
            with self.assertRaises(transport.ProtocolError):
                client.chat(messages=[], model='m')

    def test_duplicate_call_ids_never_dispatch(self):
        calls = [{'id': 'same', 'type': 'function', 'function': {'name': 'list_files', 'arguments': '{}'}} for _ in range(2)]
        client, _ = make_client(sse([{'choices': [{'message': {'tool_calls': calls}, 'finish_reason': 'tool_calls'}]}]))
        with self.assertRaises(transport.IncompleteResponse):
            client.chat(messages=[], model='m')

    def test_cancel_while_waiting_for_headers_closes_late_response(self):
        cancel = threading.Event()
        response = FakeResponse(b'data: [DONE]\n\n')
        client, opener = make_client()
        def late_headers(*args, **kwargs):
            cancel.set()
            return response
        opener.open = late_headers
        with self.assertRaises(transport.Cancelled):
            client.chat(messages=[], model='m', cancel=cancel)
        self.assertTrue(response.closed)
        self.assertNotIn(cancel, transport._ACTIVE)

    def test_error_payload_never_exposes_raw_key_or_prompt(self):
        client, _ = make_client(sse([{'error': {'message': SECRET + ' private prompt', 'code': SECRET}}]))
        with self.assertRaises(transport.ProtocolError) as error:
            client.chat(messages=[], model='m')
        self.assertNotIn(SECRET, str(error.exception))
        self.assertNotIn('private prompt', str(error.exception))

    def test_nonfinite_timeout_rejected_before_network(self):
        for timeout in (math.inf, math.nan, 0, -1, 301):
            with self.subTest(timeout=timeout), self.assertRaises(transport.TransportError):
                transport.Client('https://api.example.com', timeout=timeout)

    def test_requested_max_does_not_fabricate_effective_max(self):
        client, _ = make_client(sse([{'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]}]))
        result = client.chat(messages=[], model='m', reasoning_effort='max')
        self.assertEqual(result['requested_reasoning_effort'], 'max')
        self.assertIsNone(result['effective_reasoning_effort'])
        self.assertEqual(result['reasoning_verification'], 'unknown')

    def test_real_loopback_sse_completion_does_not_wait_for_connection_close(self):
        release = threading.Event()
        body = sse([{'choices': [{'delta': {'content': '完整✓'}, 'finish_reason': 'stop'}]}]) + b'\n'
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                release.wait(4)
                self.close_connection = True
            def log_message(self, *args):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        thread.start()
        try:
            client = transport.Client('http://127.0.0.1:%s' % server.server_port, SECRET, timeout=.5)
            result = client.chat(messages=[], model='m')
            self.assertTrue(result['complete'])
            self.assertEqual(result['answer'], '完整✓')
            self.assertFalse(release.is_set())
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_incremental_utf8_and_sse_boundaries(self):
        raw = b': keep-alive\r\n\r\n' + sse([{'choices': [{'delta': {'content': '文字✓'}, 'finish_reason': 'stop'}]}])
        class ByteResponse(FakeResponse):
            def read1(self, size):
                return super().read(1)
        client, opener = make_client()
        response = ByteResponse(raw)
        opener.open = lambda *args, **kwargs: response
        result = client.chat(messages=[], model='m')
        self.assertEqual(result['answer'], '文字✓')
        self.assertTrue(response.closed)
