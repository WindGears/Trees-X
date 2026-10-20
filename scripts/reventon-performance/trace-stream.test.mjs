import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTraceStream, TRACE_MAX_BYTES, TRACE_READ_BYTES } from './trace-stream.mjs'

function stream(responses, closeFailure = null) {
  const calls = []
  return {
    calls,
    async send(method, parameters) {
      calls.push({ method, parameters })
      if (method === 'IO.close') {
        if (closeFailure) throw closeFailure
        return {}
      }
      assert.equal(method, 'IO.read')
      const response = responses.shift()
      if (response instanceof Error) throw response
      assert.ok(response, 'Reader must stop after EOF/failure/budget rejection')
      return response
    },
  }
}

describe('bounded CDP trace stream', () => {
  it('reads mixed UTF-8/base64 chunks at one MiB and closes exactly once', async () => {
    const text = JSON.stringify({ traceEvents: [{ name: '帧', args: { complete: true } }] }),
      bytes = Buffer.from(text),
      split = bytes.indexOf(Buffer.from('帧')) + 1,
      source = stream([
        { data: bytes.subarray(0, 5).toString('utf8'), eof: false },
        { data: bytes.subarray(5, split).toString('base64'), base64Encoded: true, eof: false },
        { data: bytes.subarray(split).toString('base64'), base64Encoded: true, eof: true },
      ])
    const result = await readTraceStream(source, 'trace-handle')
    assert.deepEqual(result.trace, JSON.parse(text))
    assert.equal(result.metadata.available, true)
    assert.equal(result.metadata.bytesRead, bytes.length)
    assert.equal(result.metadata.bytesRetained, bytes.length)
    assert.equal(result.metadata.maxBytes, TRACE_MAX_BYTES)
    assert.equal(result.metadata.closed, true)
    assert.equal(result.metadata.eof, true)
    assert.equal(result.metadata.chunks, 3)
    assert.deepEqual(
      source.calls.filter((call) => call.method === 'IO.read'),
      Array.from({ length: 3 }, () => ({
        method: 'IO.read',
        parameters: { handle: 'trace-handle', size: TRACE_READ_BYTES },
      })),
    )
    assert.deepEqual(source.calls.at(-1), {
      method: 'IO.close',
      parameters: { handle: 'trace-handle' },
    })
    assert.equal(source.calls.filter((call) => call.method === 'IO.close').length, 1)
  })

  it('stops retaining and reading immediately after the byte budget is exceeded', async () => {
    const source = stream([
      { data: '1234', eof: false },
      { data: Buffer.from('5678').toString('base64'), base64Encoded: true, eof: false },
      { data: 'must-not-read', eof: true },
    ])
    const { trace, metadata } = await readTraceStream(source, 'large', { maxBytes: 6 })
    assert.equal(trace, null)
    assert.equal(metadata.available, false)
    assert.equal(metadata.bytesRead, 8)
    assert.equal(metadata.bytesRetained, 4)
    assert.equal(metadata.chunks, 2)
    assert.equal(metadata.closed, true)
    assert.match(metadata.reason, /exceeded.*byte budget.*unavailable/)
    assert.equal(source.calls.length, 3)
  })

  it('marks truncated or wrong-shape JSON unavailable, closing the stream', async () => {
    for (const data of ['{"traceEvents":[', '{"events":[]}', 'null']) {
      const source = stream([{ data, eof: true }]),
        result = await readTraceStream(source, 'invalid')
      assert.equal(result.trace, null)
      assert.equal(result.metadata.available, false)
      assert.equal(result.metadata.eof, true)
      assert.equal(result.metadata.closed, true)
      assert.match(result.metadata.reason, /incomplete or invalid.*unavailable/)
    }
  })

  it('handles a read rejection and a stalled stream without an unbounded loop', async () => {
    for (const response of [new Error('disconnected'), { data: '', eof: false }]) {
      const source = stream([response]),
        result = await readTraceStream(source, 'failed-read')
      assert.equal(result.trace, null)
      assert.equal(result.metadata.available, false)
      assert.equal(result.metadata.closed, true)
      assert.match(result.metadata.reason, /Trace read unavailable/)
      assert.equal(source.calls.length, 2)
    }
  })

  it('reports IO.close failure without replacing the original unavailable reason', async () => {
    const source = stream([{ data: '{', eof: true }], new Error('close rejected')),
      result = await readTraceStream(source, 'close-failure')
    assert.equal(result.trace, null)
    assert.equal(result.metadata.closed, false)
    assert.equal(result.metadata.available, false)
    assert.match(result.metadata.reason, /JSON incomplete or invalid/)
    assert.match(result.metadata.closeFailure, /close rejected/)
  })

  it('rejects unsafe configurable budgets before reading and still closes', async () => {
    for (const maxBytes of [0, -1, 0.5, TRACE_MAX_BYTES + 1, Infinity]) {
      const source = stream([]),
        result = await readTraceStream(source, 'invalid-budget', { maxBytes })
      assert.equal(result.trace, null)
      assert.equal(result.metadata.closed, true)
      assert.match(result.metadata.reason, /byte budget must be between/)
      assert.deepEqual(
        source.calls.map((call) => call.method),
        ['IO.close'],
      )
    }
  })

  it('retains a complete within-budget raw artifact without serializing the parsed tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trees-trace-'))
    try {
      const outputPath = join(directory, 'trace.json'),
        text = '{ "traceEvents": [] }\n',
        source = stream([{ data: text, eof: true }]),
        result = await readTraceStream(source, 'artifact', { outputPath })
      assert.equal(result.metadata.available, true)
      assert.equal(result.metadata.outputPath, outputPath)
      assert.equal(await readFile(outputPath, 'utf8'), text)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
