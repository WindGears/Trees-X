"""OpenAI-compatible chat transport built on the Python standard library.

No network I/O happens at import time; requests are only issued through
:class:`Client`. Redirects are always refused so an ``Authorization`` header
can never leak to a different origin.
"""

from __future__ import annotations

import json
import codecs
import math
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPException

__all__ = [
    'Client',
    'TransportError',
    'ProtocolError',
    'IncompleteResponse',
    'Cancelled',
    'RequestTimeout',
    'ResponseTooLarge',
    'HTTPStatusError',
    'redact',
    'cancel_active',
    'MAX_RESPONSE_BYTES',
    'MAX_JSON_BYTES',
    'MAX_TOOLS',
    'MAX_TOOL_ARGUMENT_BYTES',
    'MAX_TOOL_NAME_CHARS',
    'MAX_TOOL_ID_CHARS',
]

MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_TOOLS = 64
MAX_TOOL_ARGUMENT_BYTES = 2 * 1024 * 1024
MAX_TOOL_NAME_CHARS = 64
MAX_TOOL_ID_CHARS = 128

_LOOPBACK_HOSTS = frozenset({'127.0.0.1', 'localhost', '::1'})
_DONE = '[DONE]'
_SUCCESS_FINISH = frozenset({'stop', 'tool_calls'})
_ALLOWED_EFFORT = frozenset({'low', 'high', 'max'})
_CHUNK = 65536

_TEXT_BLOCK_TYPES = frozenset({'text', 'output_text'})
_TOOL_NAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,%d}$' % MAX_TOOL_NAME_CHARS)
_TOOL_ID_RE = re.compile(r'^[A-Za-z0-9_.:-]{1,%d}$' % MAX_TOOL_ID_CHARS)
_BACKSLASH = chr(0x5C)

_ACTIVE_LOCK = threading.Lock()
_ACTIVE = {}


class TransportError(Exception):
    '''Base class for every failure raised by this module.'''


class ProtocolError(TransportError):
    '''The server response could not be decoded.'''


class IncompleteResponse(ProtocolError):
    '''The stream ended without a successful, complete answer.'''


class Cancelled(TransportError):
    '''The caller cancelled the request.'''


class RequestTimeout(TransportError):
    '''The request exceeded its deadline or the socket timeout.'''


class ResponseTooLarge(TransportError):
    '''The response exceeded the supported size.'''


class HTTPStatusError(TransportError):
    '''The server answered with a non-success HTTP status code.'''

    def __init__(self, status_code, message=None):
        self.status_code = int(status_code)
        text = 'HTTP status %d' % self.status_code
        if message:
            text = text + ': ' + str(message)
        super().__init__(text)


_BEARER_RE = re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+')


def redact(text, secrets=()):
    '''Replace explicit secrets and any Bearer credential with a placeholder.'''
    result = str(text)
    for secret in secrets or ():
        if secret:
            result = result.replace(str(secret), '[REDACTED]')
    return _BEARER_RE.sub('Bearer [REDACTED]', result)


def _reject_constant(name):
    '''``json.loads`` hook: NaN, Infinity and -Infinity are not valid JSON.'''
    raise ValueError('non-finite JSON number: %s' % name)


def _json_loads(text):
    '''Decode JSON, refusing NaN/Infinity which are not valid JSON.'''
    return json.loads(text, parse_constant=_reject_constant)


def _json_dumps(obj):
    '''Encode compact JSON, refusing to emit NaN/Infinity.'''
    return json.dumps(
        obj, separators=(',', ':'), ensure_ascii=False, allow_nan=False
    )


def _describe_error(error):
    '''Upstream errors can echo prompts or keys; never surface their body.'''
    return 'upstream error payload omitted'


def _origin(url):
    '''Return the (scheme, host, port) triple used for origin checks.'''
    parts = urllib.parse.urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        raise TransportError('URL contains an invalid port') from None
    if port is None:
        port = 443 if parts.scheme.lower() == 'https' else 80
    return (parts.scheme.lower(), (parts.hostname or '').lower(), port)


def _check_same_origin(base_url, url):
    if _origin(url) != _origin(base_url):
        raise TransportError('request URL must stay on the client origin')
    return url


def _relative_path(path):
    '''Validate a same-origin relative path and return it unchanged.

    The path must be a plain route below ``base_url``: it has to start
    with a single ``/`` and must not smuggle an absolute URL, a protocol
    relative ``//host`` prefix, a query string, a fragment or whitespace.
    '''
    if not isinstance(path, str) or not path:
        raise TransportError('path must be a relative path starting with /')
    if not path.startswith('/'):
        raise TransportError('path must be a relative path starting with /')
    if '//' in path:
        raise TransportError('path must not contain //')
    parts = urllib.parse.urlsplit(path)
    if parts.scheme or parts.netloc:
        raise TransportError('path must not be an absolute URL')
    if parts.query:
        raise TransportError('path must not contain a query string')
    if parts.fragment:
        raise TransportError('path must not contain a fragment')
    if _BACKSLASH in path:
        raise TransportError('path must not contain a backslash')
    for char in path:
        if char.isspace() or ord(char) < 0x20 or ord(char) == 0x7F:
            raise TransportError('path must not contain whitespace')
    return path


def _response_status(response):
    '''Return the integer HTTP status of a response, or ``None``.'''
    status = getattr(response, 'status', None)
    if status is None:
        getcode = getattr(response, 'getcode', None)
        if callable(getcode):
            try:
                status = getcode()
            except Exception:
                status = None
    if isinstance(status, bool) or not isinstance(status, int):
        return None
    return status


def _split_base_url(base_url):
    if not isinstance(base_url, str) or not base_url:
        raise TransportError('base_url must be a non-empty string')
    parts = urllib.parse.urlsplit(base_url)
    scheme = parts.scheme.lower()
    if scheme not in ('http', 'https'):
        raise TransportError('base_url scheme must be https')
    if parts.username or parts.password or '@' in parts.netloc:
        raise TransportError('base_url must not contain user info')
    if parts.query:
        raise TransportError('base_url must not contain a query string')
    if parts.fragment:
        raise TransportError('base_url must not contain a fragment')
    host = parts.hostname
    if not host:
        raise TransportError('base_url must include a host')
    if scheme == 'http' and host not in _LOOPBACK_HOSTS:
        raise TransportError('http base_url is only allowed for loopback hosts')
    return parts


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    '''Refuse every redirect instead of forwarding credentials.'''

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TransportError('redirect refused (HTTP %s)' % int(code))


def cancel_active(event):
    '''Close the in-flight response registered for ``event``.

    Returns ``True`` when an active response existed and was closed.
    '''
    if event is None:
        return False
    with _ACTIVE_LOCK:
        response = _ACTIVE.pop(event, None)
    if response is None:
        return False
    try:
        response.close()
    except Exception:
        pass
    return True


class _Accumulator:
    __slots__ = (
        'model',
        'content',
        'tools',
        'usage',
        'finish_reason',
        'done',
        'effective_reasoning_effort',
    )

    def __init__(self):
        self.model = None
        self.content = []
        self.tools = {}
        self.usage = None
        self.finish_reason = None
        self.done = False
        self.effective_reasoning_effort = None


def _numeric(value, depth=0):
    '''Keep only finite numeric leaves; everything else is dropped.'''
    if depth > 6:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return value
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if not isinstance(key, str):
                continue
            number = _numeric(item, depth + 1)
            if number is not None:
                out[key] = number
        return out or None
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            number = _numeric(item, depth + 1)
            if number is not None:
                out.append(number)
        return out or None
    return None


def _add_content(content, acc):
    '''Collect answer text; reasoning and other block types are ignored.

    Only blocks whose ``type`` is ``text`` or ``output_text`` contribute
    to the answer, so reasoning/thinking content can never be returned.
    '''
    if content is None:
        return
    if isinstance(content, str):
        if content:
            acc.content.append(content)
        return
    if isinstance(content, list):
        for item in content:
            if isinstance(item, str):
                if item:
                    acc.content.append(item)
                continue
            if not isinstance(item, dict):
                continue
            if item.get('type') not in _TEXT_BLOCK_TYPES:
                continue
            text = item.get('text')
            if isinstance(text, str) and text:
                acc.content.append(text)
        return
    raise ProtocolError('malformed content in stream event')


def _next_tool_index(acc):
    if not acc.tools:
        return 0
    return max(acc.tools) + 1


def _tool_index(item, position, fragmented, acc):
    '''Resolve the slot a tool call entry belongs to.

    Complete entries without an index are enumerated by their position in
    the list. Streamed fragments must carry a usable index: a fragment
    without one gets its own fresh slot instead of being merged into
    index 0, and a malformed index is rejected.
    '''
    index = item.get('index')
    if index is None:
        if fragmented:
            return _next_tool_index(acc)
        return position
    if isinstance(index, bool) or not isinstance(index, int):
        raise ProtocolError('malformed tool call index')
    if index < 0:
        raise ProtocolError('tool call index must not be negative')
    return index


def _add_tool_calls(tool_calls, acc, fragmented=True):
    if not isinstance(tool_calls, list):
        raise ProtocolError('malformed tool_calls in stream event')
    for position, item in enumerate(tool_calls):
        if not isinstance(item, dict):
            raise ProtocolError('malformed tool call in stream event')
        index = _tool_index(item, position, fragmented, acc)
        entry = acc.tools.get(index)
        if entry is None:
            if len(acc.tools) >= MAX_TOOLS:
                raise ProtocolError('too many tool calls (max %d)' % MAX_TOOLS)
            entry = {'id': None, 'name': '', 'arguments': ''}
            acc.tools[index] = entry
        identifier = item.get('id')
        if isinstance(identifier, str) and identifier:
            if len(identifier) > MAX_TOOL_ID_CHARS:
                raise ProtocolError('tool call id is too long')
            entry['id'] = identifier
        elif identifier is not None and not isinstance(identifier, str):
            raise ProtocolError('malformed tool call id')
        function = item.get('function')
        if function is None:
            continue
        if not isinstance(function, dict):
            raise ProtocolError('malformed tool call function')
        name = function.get('name')
        if isinstance(name, str) and name:
            if len(entry['name']) + len(name) > MAX_TOOL_NAME_CHARS:
                raise ProtocolError('tool call name is too long')
            entry['name'] += name
        elif name is not None and not isinstance(name, str):
            raise ProtocolError('malformed tool call name')
        arguments = function.get('arguments')
        if isinstance(arguments, str):
            entry['arguments'] += arguments
        elif isinstance(arguments, dict):
            try:
                entry['arguments'] += _json_dumps(arguments)
            except ValueError:
                raise ProtocolError('malformed tool call arguments') from None
        elif arguments is not None:
            raise ProtocolError('malformed tool call arguments')
        if len(entry['arguments'].encode('utf-8')) > MAX_TOOL_ARGUMENT_BYTES:
            raise ProtocolError('tool call arguments too large')


def _merge(obj, acc, streaming=True):
    '''Fold one decoded JSON event/body into the accumulator.

    A server reported ``error`` is never ignored: it aborts the request.
    '''
    error = obj.get('error')
    if error:
        raise ProtocolError(
            'server reported an error: ' + _describe_error(error)
        )

    model = obj.get('model')
    if acc.model is None and isinstance(model, str) and model:
        acc.model = model

    effort = obj.get('reasoning_effort')
    if isinstance(effort, str) and effort:
        acc.effective_reasoning_effort = effort

    usage = obj.get('usage')
    if usage is not None:
        numeric = _numeric(usage)
        if numeric:
            acc.usage = numeric

    choices = obj.get('choices')
    if choices is None:
        return
    if not isinstance(choices, list):
        raise ProtocolError('malformed choices in stream event')
    if not choices:
        return
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ProtocolError('malformed choice in stream event')

    finish = choice.get('finish_reason')
    if finish is not None:
        if not isinstance(finish, str):
            raise ProtocolError('malformed finish_reason')
        acc.finish_reason = finish

    delta = choice.get('delta')
    from_message = False
    if not isinstance(delta, dict):
        message = choice.get('message')
        if isinstance(message, dict):
            delta = message
            from_message = True
    if not isinstance(delta, dict):
        return

    _add_content(delta.get('content'), acc)
    tool_calls = delta.get('tool_calls')
    if tool_calls is not None:
        _add_tool_calls(
            tool_calls, acc, fragmented=bool(streaming) and not from_message
        )


def _apply_event(payload, acc):
    data = payload.strip()
    if not data:
        return
    if data == _DONE:
        acc.done = True
        return
    try:
        obj = _json_loads(data)
    except ValueError:
        raise ProtocolError('malformed JSON in stream event') from None
    if not isinstance(obj, dict):
        raise ProtocolError('unexpected JSON event payload')
    _merge(obj, acc)


def _normalize_tools(tools):
    if tools is None:
        return None
    if isinstance(tools, (str, bytes, dict)) or not hasattr(tools, '__iter__'):
        raise TransportError('tools must be a sequence of function definitions')
    items = list(tools)
    if not items:
        return None
    if len(items) > MAX_TOOLS:
        raise TransportError('too many tools (max %d)' % MAX_TOOLS)
    normalized = []
    for item in items:
        if not isinstance(item, dict) or item.get('type') != 'function':
            raise TransportError('only function tools are supported')
        function = item.get('function')
        if not isinstance(function, dict):
            raise TransportError('function tool must define a function object')
        name = function.get('name')
        if not isinstance(name, str) or not name:
            raise TransportError('function tool requires a name')
        clean = {'name': name}
        if isinstance(function.get('description'), str):
            clean['description'] = function['description']
        if isinstance(function.get('parameters'), dict):
            clean['parameters'] = function['parameters']
        normalized.append({'type': 'function', 'function': clean})
    return normalized


def _finalize(acc, request_model, requested_effort, require_done):
    if require_done and not acc.done:
        raise IncompleteResponse('stream ended before the completion marker')
    if acc.finish_reason not in _SUCCESS_FINISH:
        raise IncompleteResponse('unsuccessful finish_reason: %r' % (acc.finish_reason,))

    answer = ''.join(acc.content)
    tool_calls = []
    identifiers = set()
    for index in sorted(acc.tools):
        entry = acc.tools[index]
        identifier = entry['id']
        if not identifier:
            raise IncompleteResponse('tool call %d is missing an id' % index)
        if not _TOOL_ID_RE.fullmatch(identifier) or identifier in identifiers:
            raise IncompleteResponse('tool call id is not valid')
        identifiers.add(identifier)
        name = entry['name']
        if not _TOOL_NAME_RE.fullmatch(name):
            raise IncompleteResponse('tool call name is not valid')
        arguments = entry['arguments'].strip()
        if arguments == '':
            arguments = '{}'
        try:
            decoded = _json_loads(arguments)
        except ValueError:
            raise IncompleteResponse('tool call arguments are not valid JSON') from None
        if not isinstance(decoded, dict):
            raise IncompleteResponse('tool call arguments must be a JSON object')
        tool_calls.append({
            'id': identifier,
            'type': 'function',
            'function': {'name': name, 'arguments': arguments},
        })

    if not answer and not tool_calls:
        raise IncompleteResponse('response contained neither content nor tool calls')

    return {
        'model': acc.model or request_model,
        'answer': answer,
        'tool_calls': tool_calls,
        'usage': acc.usage,
        'finish_reason': acc.finish_reason,
        'requested_reasoning_effort': requested_effort,
        'effective_reasoning_effort': acc.effective_reasoning_effort,
        'reasoning_verification': 'upstream_reported' if acc.effective_reasoning_effort else 'unknown',
        'complete': True,
    }


class Client:
    '''Small synchronous client for an OpenAI-compatible endpoint.'''

    def __init__(self, base_url, api_key=None, timeout=45):
        _split_base_url(base_url)
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.timeout = float(timeout)
        if not math.isfinite(self.timeout) or not 0 < self.timeout <= 300:
            raise TransportError('timeout must be positive and at most 300 seconds')
        self._opener = urllib.request.build_opener(_NoRedirectHandler())

    # -- helpers ---------------------------------------------------------

    def _headers(self, accept):
        headers = {
            'Content-Type': 'application/json',
            'Accept': accept,
        }
        if self.api_key:
            headers['Authorization'] = 'Bearer ' + self.api_key
        return headers

    def _check_stop(self, cancel, deadline):
        if cancel is not None and cancel.is_set():
            raise Cancelled('request cancelled')
        if deadline is not None and time.monotonic() > deadline:
            raise RequestTimeout('deadline exceeded')

    def _socket_timeout(self, deadline):
        if deadline is None:
            return self.timeout
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RequestTimeout('deadline exceeded')
        return max(0.001, min(self.timeout, remaining))

    def _send(self, request, cancel, sock_timeout):
        try:
            response = self._opener.open(request, timeout=sock_timeout)
        except TransportError:
            raise
        except urllib.error.HTTPError as exc:
            code = getattr(exc, 'code', None)
            try:
                exc.close()
            except Exception:
                pass
            if cancel is not None and cancel.is_set():
                raise Cancelled('request cancelled') from None
            if code is None:
                raise TransportError('request failed') from None
            raise HTTPStatusError(code) from None
        except urllib.error.URLError as exc:
            if cancel is not None and cancel.is_set():
                raise Cancelled('request cancelled') from None
            reason = getattr(exc, 'reason', None)
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise RequestTimeout('request timed out') from None
            raise TransportError('request failed') from None
        except (socket.timeout, TimeoutError):
            if cancel is not None and cancel.is_set():
                raise Cancelled('request cancelled') from None
            raise RequestTimeout('request timed out') from None
        except Exception:
            if cancel is not None and cancel.is_set():
                raise Cancelled('request cancelled') from None
            raise TransportError('request failed') from None
        status = _response_status(response)
        if status is not None and not 200 <= status < 300:
            if cancel is not None:
                with _ACTIVE_LOCK:
                    _ACTIVE.pop(cancel, None)
            try:
                response.close()
            except Exception:
                pass
            raise HTTPStatusError(status)
        if cancel is not None:
            with _ACTIVE_LOCK:
                _ACTIVE[cancel] = response
            if cancel.is_set():
                cancel_active(cancel)
                raise Cancelled('request cancelled')
        return response

    def _release(self, cancel):
        if cancel is None:
            return
        with _ACTIVE_LOCK:
            _ACTIVE.pop(cancel, None)

    def _read_body(self, response, cancel, deadline, limit=None):
        if limit is None:
            limit = MAX_RESPONSE_BYTES
        chunks = []
        total = 0
        while True:
            self._check_stop(cancel, deadline)
            try:
                chunk = response.read(_CHUNK)
            except TransportError:
                raise
            except (socket.timeout, TimeoutError):
                raise RequestTimeout('response read timed out') from None
            except HTTPException:
                raise IncompleteResponse('response stream truncated') from None
            except Exception:
                if cancel is not None and cancel.is_set():
                    raise Cancelled('request cancelled') from None
                raise TransportError('response stream read failed') from None
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise ResponseTooLarge('response exceeds %d bytes' % limit)
            chunks.append(chunk)
        return b''.join(chunks)

    def _read_chat_response(self, response, cancel, deadline):
        """Parse bounded SSE incrementally and finish at DONE, not socket EOF.

        HTTPResponse.read1 returns available bytes without waiting to fill the
        requested buffer. JSON fallback is buffered and strictly decoded.
        Private reasoning deltas are discarded while processing events.
        """
        decoder = codecs.getincrementaldecoder('utf-8')('strict')
        read = getattr(response, 'read1', response.read)
        mode = None
        undecided = ''
        line = ''
        pending = []
        json_parts = []
        total = 0
        acc = _Accumulator()

        def consume(value):
            if value.endswith('\r'):
                value = value[:-1]
            if not value:
                if pending:
                    _apply_event('\n'.join(pending), acc)
                    pending.clear()
            elif value.startswith('data:'):
                data = value[5:]
                pending.append(data[1:] if data.startswith(' ') else data)

        while True:
            self._check_stop(cancel, deadline)
            try:
                chunk = read(_CHUNK)
            except (socket.timeout, TimeoutError):
                self._check_stop(cancel, deadline)
                raise RequestTimeout('response read timed out') from None
            except HTTPException:
                raise IncompleteResponse('response stream truncated') from None
            except Exception:
                self._check_stop(cancel, deadline)
                raise TransportError('response stream read failed') from None
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise ResponseTooLarge('response exceeds %d bytes' % MAX_RESPONSE_BYTES)
            try:
                text = decoder.decode(chunk, final=not bool(chunk))
            except UnicodeDecodeError:
                raise ProtocolError('response is not valid UTF-8') from None
            self._check_stop(cancel, deadline)
            if mode is None:
                undecided += text
                if undecided.strip():
                    mode = 'json' if undecided.lstrip().startswith('{') else 'sse'
                    text = undecided
                    undecided = ''
            if mode == 'json':
                json_parts.append(text)
            elif mode == 'sse':
                line += text
                while '\n' in line:
                    value, line = line.split('\n', 1)
                    consume(value)
                    if acc.done:
                        return acc, True
            if not chunk:
                if mode == 'json':
                    return self._parse_body(''.join(json_parts).encode('utf-8'), cancel, deadline)
                if line:
                    consume(line)
                if pending and not acc.done:
                    _apply_event('\n'.join(pending), acc)
                return acc, True

    def _parse_sse(self, text, cancel, deadline, acc):
        pending = []
        for raw_line in text.split('\n'):
            self._check_stop(cancel, deadline)
            line = raw_line[:-1] if raw_line.endswith('\r') else raw_line
            if line == '':
                if pending:
                    _apply_event('\n'.join(pending), acc)
                    pending = []
                    if acc.done:
                        return
                continue
            if line.startswith(':'):
                continue
            if line.startswith('data:'):
                value = line[5:]
                if value.startswith(' '):
                    value = value[1:]
                pending.append(value)
                continue
            # event:, id:, retry: and any other field are ignored on purpose.
        if pending and not acc.done:
            _apply_event('\n'.join(pending), acc)

    def _parse_body(self, raw, cancel, deadline):
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            raise ProtocolError('response is not valid UTF-8') from None
        acc = _Accumulator()
        stripped = text.lstrip()
        if stripped.startswith('{'):
            try:
                obj = _json_loads(stripped)
            except ValueError:
                raise ProtocolError('malformed JSON response body') from None
            if not isinstance(obj, dict):
                raise ProtocolError('malformed JSON response body')
            _merge(obj, acc, streaming=False)
            return acc, False
        self._parse_sse(text, cancel, deadline, acc)
        return acc, True

    # -- public API ------------------------------------------------------

    def cancel_active(self, event):
        '''Cancel the in-flight request that ``event`` was issued with.

        Thin delegate to the module level :func:`cancel_active`. Returns
        ``True`` when an active response was found and closed.
        '''
        return cancel_active(event)

    def chat(
        self,
        *,
        messages,
        model,
        reasoning_effort='max',
        max_output_tokens=None,
        tools=None,
        cancel=None,
        deadline=None,
    ):
        if not self.api_key:
            raise TransportError('api_key is required for chat requests')
        if not isinstance(model, str) or not model:
            raise TransportError('model is required')
        if reasoning_effort is not None and reasoning_effort not in _ALLOWED_EFFORT:
            raise TransportError('reasoning_effort must be low, high, max or None')
        if max_output_tokens is not None:
            if isinstance(max_output_tokens, bool) or not isinstance(
                max_output_tokens, int
            ):
                raise TransportError('max_output_tokens must be a positive integer')
            if max_output_tokens <= 0:
                raise TransportError('max_output_tokens must be a positive integer')

        self._check_stop(cancel, deadline)

        payload = {'model': model, 'messages': list(messages), 'stream': True}
        if reasoning_effort is not None:
            payload['reasoning_effort'] = reasoning_effort
        if max_output_tokens is not None:
            payload['max_tokens'] = max_output_tokens
        normalized_tools = _normalize_tools(tools)
        if normalized_tools:
            payload['tools'] = normalized_tools

        try:
            body = _json_dumps(payload).encode('utf-8')
        except ValueError:
            raise TransportError('request contains a non-finite number') from None
        except UnicodeEncodeError:
            raise TransportError('request is not encodable as UTF-8') from None
        request = urllib.request.Request(
            self.base_url + '/chat/completions', data=body, method='POST'
        )
        for name, value in self._headers('text/event-stream').items():
            request.add_header(name, value)

        sock_timeout = self._socket_timeout(deadline)
        response = self._send(request, cancel, sock_timeout)
        try:
            acc, require_done = self._read_chat_response(response, cancel, deadline)
        finally:
            self._release(cancel)
            try:
                response.close()
            except Exception:
                pass

        return _finalize(acc, model, reasoning_effort, require_done)

    def get_json(self, path, cancel=None):
        '''GET a same-origin relative path and decode its JSON body.

        Public endpoints can be read without an api key; in that case no
        ``Authorization`` header is sent at all. Bodies larger than
        :data:`MAX_JSON_BYTES` are refused.
        '''
        clean = _relative_path(path)
        url = _check_same_origin(self.base_url, self.base_url + clean)

        request = urllib.request.Request(url, method='GET')
        for name, value in self._headers('application/json').items():
            request.add_header(name, value)

        response = self._send(request, cancel, self.timeout)
        try:
            raw = self._read_body(response, cancel, None, limit=MAX_JSON_BYTES)
        finally:
            self._release(cancel)
            try:
                response.close()
            except Exception:
                pass

        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            raise ProtocolError('malformed JSON response body') from None
        try:
            return _json_loads(text)
        except ValueError:
            raise ProtocolError('malformed JSON response body') from None
